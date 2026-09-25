import type { ICrmJobFile } from '../../../database/schemas/crm-job-result.schema';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { TFeatureKey } from '../../telegram/bots/shared/features.domain';

/**
 * Потолок результата в документе. Лимит документа Mongo — 16 МБ; запас на
 * служебные поля и BSON-обвязку, чтобы до лимита дело не доходило вовсе.
 */
export const MAX_RESULT_BYTES = 15 * 1024 * 1024;

/**
 * Сколько задач CRM выполняется одновременно — на ВСЕХ продавцов разом.
 *
 * Дефолт `@Process` — 1, и с ним главная магазина собиралась по очереди:
 * быстрые плитки заказов по десятки секунд стояли за «Прибылью», а тяжёлый
 * отчёт одного продавца задерживал CRM всем остальным. Поднимать можно, потому
 * что ни один лимит здесь не держится очередью: одна задача на (продавец, kind,
 * магазин) — это `activeKey`; остатки FBY 1/мин — single-flight и мемо в
 * `FbyStockService`; квоты отчётов Маркета — у самого Маркета, 420 → текст.
 * Запись остатков идёт НЕ сюда, а в `file-processing` с concurrency 1.
 *
 * Не больше: квоты Partner API — на токен продавца, и четыре его плитки разом
 * — как раз главная целиком. В процессоре должен остаться ОДИН `@Process`:
 * Bull суммирует concurrency всех обработчиков очереди (урок TASK-080).
 */
export const CRM_JOBS_CONCURRENCY = 4;

/** Payload джобы: без токена — креды процессор перечитывает из Mongo. */
export interface ICrmJobPayload {
  jobId: string;
  telegramUserId: string;
  kind: string;
  params: Record<string, unknown>;
  /**
   * Снимок разрешённых фич на момент постановки (у админа — все). Паттерн
   * `tariffEstimate`/`deepHistory` бота: решение едет в payload, а kind не
   * читает UserAccess сам — у админа записи нет, и перепроверка по default-off
   * фиче отбила бы именно его. У задач, поставленных до появления поля, его нет.
   */
  features?: Record<string, boolean>;
  /**
   * Магазин, открытый в вебе. Веб активный магазин бота не пишет, поэтому
   * процессор перекрывает документ этой кампанией (`scopeStore`). Задачи,
   * поставленные до появления поля, считаются по активному магазину.
   */
  campaignId?: string;
}

export interface ICrmJobContext {
  telegramUserId: string;
  store: YandexMarketDocument;
  params: Record<string, unknown>;
  /** Модификаторы вроде deep_history; пустой объект — умолчания реестра фич. */
  features: Record<string, boolean>;
}

export interface ICrmJobOutput {
  data: unknown;
  file?: ICrmJobFile | null;
}

export interface ICrmJobKind {
  /** Все ключи обязательны — правило `@RequireFeature`. */
  features: readonly TFeatureKey[];
  run(context: ICrmJobContext): Promise<ICrmJobOutput>;
}

/**
 * Ошибка, текст которой готов для продавца как есть («нет данных за период»,
 * «выберите категорию»). Всё прочее описывается общим `reportErrorMessage`.
 */
export class CrmJobError extends Error {}

/** Магазин из ссылки токен больше не открывает (кэш обновился, токен сменили). */
export const STORE_GONE_TEXT =
  'Этот магазин больше не открывается по вашему токену — откройте магазин заново из списка «Магазины».';

export function resultBytes(output: ICrmJobOutput): number {
  const data = output.data === undefined ? 0 : Buffer.byteLength(JSON.stringify(output.data));
  return data + (output.file?.buffer.length ?? 0);
}

export function tooLargeText(bytes: number): string {
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return `Результат слишком большой (${mb} МБ) — выберите период короче.`;
}

/**
 * Текст бота без ведущего значка («💳 За период…» → «За период…»). Веб рисует
 * состояние своими иконками, а формулировку берёт у бота как есть — копия
 * фразы разошлась бы с ботом (довод `reportErrorMessage`).
 */
export function withoutIcon(text: string): string {
  return text.replace(/^[^\p{L}\p{N}«"(]+/u, '');
}

/** MIME xlsx — у всех kind-ов, отдающих книгу. */
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
