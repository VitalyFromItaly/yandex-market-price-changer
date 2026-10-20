/**
 * Журнал финансовых операций Ozon (/v3/finance/transaction/list, TASK-131):
 * ключ дедупа, разбор операции в строку журнала, сводка нераспознанного.
 * Чистые функции — без Nest и базы; аналог `ym-journal.ts`.
 *
 * Операция ложится ОДНОЙ строкой (решение владельца 2026-10-18): сумма —
 * `amount`, составляющие — частями в `breakdown`, как сводная строка акта ЯМ
 * (TASK-155). Ключ и выплата у операции одни, а P&L раскладывает части по
 * статьям той же `expandBreakdown`.
 */

import type { IFinanceOperationContext, IFinanceOperationRow } from './finance-journal';
import type { IFinancePeriod } from './finance-period';
import type { IOperationBreakdownPart } from './operation-breakdown';
import type { ErrorReporter } from '../errors/error-reporter.service';

import { financeToday } from './finance-period';
import { kopecksToRub, toKopecks } from './kopecks';
import {
  OZON_COMPONENT_ARTICLE,
  OZON_RETURN_TYPES,
  OZON_SALE_TYPES,
  ozonAccrualArticle,
  ozonOperationTypeArticle,
  ozonServiceArticle,
} from './ozon-articles';
import { operationKeyOf } from './ym-journal';

type TRaw = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' ? String(value) : '';
}

/** Пояс из ответа → смещение ISO; без пояса — Москва. */
function offsetOf(zone: string | undefined): string {
  if (!zone) return MSK;
  if (zone === 'Z' || zone.includes(':')) return zone;
  return `${zone.slice(0, 3)}:${zone.slice(3)}`;
}

/** id приходят числами — строкой, чтобы не терять точность и не путать типы. */
export function ozonIdOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

const asObject = (value: unknown): TRaw =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as TRaw) : {};

const asList = (value: unknown): TRaw[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is TRaw => !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : [];

/** Московское время — фиксированный +03:00, как у ЯМ. */
const MSK = '+03:00';
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Дата операции Ozon → момент. «ГГГГ-ММ-ДД ЧЧ:ММ:СС» без пояса — время по
 * Москве (так его показывает кабинет); с поясом — как пришло. Мусор и
 * несуществующий день (2026-02-31) → null.
 */
export function parseOzonDateTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = DATE_TIME.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', frac = '', zone] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${frac}${offsetOf(zone)}`);
  if (Number.isNaN(date.getTime())) return null;
  if (!zone && financeToday(date) !== `${y}-${mo}-${d}`) return null;
  return date;
}

/** id операции — ключ дедупа Ozon (у ЯМ id нет, у Ozon есть). */
export function ozonOperationIdOf(raw: TRaw): string {
  return ozonIdOf(raw.operation_id);
}

/**
 * Ключ операции для базы. Читаемая форма — площадка, id и СУММА: сумма в
 * ключе, потому что неизменяемые поля пишутся только вставкой
 * (`MUTABLE_ON_CONFLICT`), и пересчитанная Ozon сумма с ключом по одному id
 * молча потерялась бы. С суммой в ключе пересчёт — новая строка, а прежняя
 * снимается и попадает в корректировки «изменено», как у ЯМ. Та же операция с
 * той же суммой — тот же ключ, повтор импорта дублей не даёт.
 */
export function ozonOperationKey(operationId: string, amountKopecks: number): string {
  return operationKeyOf(JSON.stringify(['ozon', operationId, amountKopecks]));
}

/** Составляющие операции по статьям; Σ частей = `amount` (остаток — `unknown`). */
export function ozonOperationParts(raw: TRaw, amountKopecks: number): IOperationBreakdownPart[] {
  const type = text(raw.operation_type);
  const parts: IOperationBreakdownPart[] = [];
  const add = (article: IOperationBreakdownPart['article'], value: unknown, sheet: string) => {
    const kopecks = toKopecks(value);
    if (kopecks) parts.push({ article, kopecks, sheet });
  };

  add(ozonAccrualArticle(type), raw.accruals_for_sale, 'accruals_for_sale');
  for (const [field, article] of Object.entries(OZON_COMPONENT_ARTICLE))
    add(article, raw[field], field);
  for (const service of asList(raw.services)) {
    const name = text(service.name);
    add(ozonServiceArticle(name), service.price, name || 'services');
  }

  const covered = parts.reduce((sum, part) => sum + part.kopecks, 0);
  if (!parts.length) {
    // Составляющих нет — вся сумма статьёй типа операции (хранение, реклама, компенсация).
    return amountKopecks
      ? [{ article: ozonOperationTypeArticle(type), kopecks: amountKopecks, sheet: null }]
      : [];
  }
  if (covered !== amountKopecks) {
    parts.push({ article: 'unknown', kopecks: amountKopecks - covered, sheet: null });
  }
  return parts;
}

/**
 * Статья строки целиком — для чтений, которые берут строку без расшифровки
 * (выплаты, счётчик нераспознанного у статуса периода). Любая нераспознанная
 * часть делает строку `unknown`: иначе счётчик статуса её не увидел бы.
 */
function rowArticle(
  type: string,
  parts: readonly IOperationBreakdownPart[],
): IOperationBreakdownPart['article'] {
  if (!parts.length) return ozonOperationTypeArticle(type);
  if (parts.some((part) => part.article === 'unknown')) return 'unknown';
  if (OZON_SALE_TYPES.has(type)) return 'sales';
  if (OZON_RETURN_TYPES.has(type)) return 'returns';
  const largest = [...parts].sort((a, b) => Math.abs(b.kopecks) - Math.abs(a.kopecks))[0];
  return largest.article;
}

/**
 * Артикул строки для себестоимости: SKU Ozon позиций → ключ закупа
 * (`skuOf`, решение владельца 2026-10-18 — резолвить при импорте). Один
 * артикул на операцию — он; ни одного или несколько — пусто: делить закуп
 * отправления по догадке нельзя, такая строка честно «без закупа».
 */
function rowSku(raw: TRaw, skuOf: (ozonSku: string) => string | undefined): string | undefined {
  const skus = new Set<string>();
  for (const item of asList(raw.items)) {
    const ozonSku = ozonIdOf(item.sku);
    if (ozonSku) skus.add(skuOf(ozonSku) ?? ozonSku);
  }
  return skus.size === 1 ? [...skus][0] : undefined;
}

/**
 * Операция Ozon → строка журнала. Без id, суммы или даты — бросает: это не
 * «операция на ноль», а форма ответа, которой мы не знаем (довод
 * `nettingRowToOperation`).
 */
export function ozonOperationToRow(
  raw: TRaw,
  ctx: IFinanceOperationContext,
  skuOf: (ozonSku: string) => string | undefined = () => undefined,
): IFinanceOperationRow {
  const operationId = ozonOperationIdOf(raw);
  if (!operationId) throw new Error('Операция Ozon без operation_id');
  const amountKopecks = toKopecks(raw.amount);
  if (amountKopecks === null) throw new Error(`Операция Ozon ${operationId} без суммы`);
  const accruedAt = parseOzonDateTime(raw.operation_date);
  if (!accruedAt) throw new Error(`Операция Ozon ${operationId} без даты`);

  const type = text(raw.operation_type);
  const parts = ozonOperationParts(raw, amountKopecks);
  const posting = asObject(raw.posting);
  const articles = new Set(parts.map((part) => part.article));

  return {
    marketplace: 'ozon',
    telegramUserId: ctx.telegramUserId,
    businessId: ctx.businessId,
    operationKey: ozonOperationKey(operationId, amountKopecks),
    article: rowArticle(type, parts),
    direction: amountKopecks < 0 ? 'expense' : 'income',
    amountKopecks,
    orderId: text(posting.posting_number) || undefined,
    sku: rowSku(raw, skuOf),
    serviceName: text(raw.operation_type_name) || undefined,
    transactionType: type,
    transactionSource: text(raw.type) || undefined,
    accruedAt,
    // FBO — склад Ozon, FBS/RFBS — продавца: схема строки, как `model` у ЯМ.
    model: text(posting.delivery_schema).toUpperCase() || undefined,
    documentId: ctx.documentId,
    documentVersion: ctx.documentVersion,
    periodKey: ctx.periodKey,
    raw,
    // Одна статья — расшифровка ничего не добавляет: строка и есть эта статья.
    ...(articles.size > 1 ? { breakdown: parts } : {}),
  };
}

/**
 * Операции, чей день (по Москве) лежит в периоде. Фильтр Ozon по датам —
 * моменты, и как он их толкует, на живом ответе не сверено; без этой проверки
 * операция на границе легла бы в два месяца, и замена версии одного снимала
 * бы её из другого. Без даты — в `dropped`: разбор всё равно бросит на ней.
 */
export function ozonOperationsInPeriod(
  raws: readonly TRaw[],
  period: IFinancePeriod,
): { ops: TRaw[]; dropped: number } {
  const ops: TRaw[] = [];
  let dropped = 0;
  for (const raw of raws) {
    const at = parseOzonDateTime(raw.operation_date);
    const day = at ? financeToday(at) : null;
    if (day && day >= period.from && day <= period.to) ops.push(raw);
    else dropped += 1;
  }
  return { ops, dropped };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as TRaw)
        .sort()
        .map((key) => [key, sortKeys((value as TRaw)[key])]),
    );
  }
  return value;
}

/**
 * «Оригинал» версии — операции периода JSON-ом. Файла у метода нет, а версии
 * документа нужен sha256: одинаковый ответ должен давать одинаковые байты,
 * поэтому ключи отсортированы, операции — по id, и нет ни момента запроса,
 * ни номеров страниц. Иначе каждый прогон заводил бы новую версию.
 *
 * Рядом — ключи закупа по SKU операций (`purchaseKeys`): артикул строки взят
 * не из ответа Ozon, а из каталога. Каталог не ответил или товар привязали
 * позже — байты другие, версия новая, и `refreshSku` допишет артикул; без
 * этого тот же ответ Ozon дал бы `unchanged`, и сырой SKU остался бы навсегда.
 */
export function ozonFinanceOriginal(
  period: IFinancePeriod,
  ops: readonly TRaw[],
  skuOf: (ozonSku: string) => string | undefined = () => undefined,
): Buffer {
  const sorted = [...ops].sort((a, b) => {
    const x = ozonOperationIdOf(a);
    const y = ozonOperationIdOf(b);
    return x.length - y.length || x.localeCompare(y);
  });
  const purchaseKeys: Record<string, string> = {};
  for (const op of sorted) {
    for (const item of asList(op.items)) {
      const sku = ozonIdOf(item.sku);
      const key = sku ? skuOf(sku) : undefined;
      if (key) purchaseKeys[sku] = key;
    }
  }
  return Buffer.from(
    JSON.stringify(sortKeys({ period, operations: sorted, purchaseKeys })),
    'utf8',
  );
}

/**
 * Отдельный класс — отдельный `errorType`, половина ключа троттлинга алертов
 * (довод `YmUnknownArticleError`).
 */
export class OzonUnknownArticleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OzonUnknownArticleError';
  }
}

/** Место алерта — без id продавца и периода: иначе троттлинг не сработает никогда. */
export const OZON_UNKNOWN_ARTICLE_CONTEXT = 'finance:ozon-articles';

export interface IOzonUnknownGroup {
  signature: string;
  count: number;
  amountKopecks: number;
}

/**
 * Нераспознанное по подписям: тип операции без составляющих, услуга или
 * остаток, которому составляющей не нашлось. Сумма — нераспознанной части,
 * а не всей операции.
 */
export function ozonUnknownGroups(ops: readonly IFinanceOperationRow[]): IOzonUnknownGroup[] {
  const groups = new Map<string, IOzonUnknownGroup>();
  const add = (signature: string, kopecks: number) => {
    const group = groups.get(signature) ?? { signature, count: 0, amountKopecks: 0 };
    group.count += 1;
    group.amountKopecks += kopecks;
    groups.set(signature, group);
  };
  for (const op of ops) {
    if (op.article !== 'unknown') continue;
    const type = op.transactionType || '(без типа)';
    const parts = op.breakdown ?? [{ article: op.article, kopecks: op.amountKopecks, sheet: null }];
    for (const part of parts) {
      if (part.article !== 'unknown') continue;
      if (part.sheet === 'accruals_for_sale') add(`выручка у типа ${type}`, part.kopecks);
      else if (part.sheet) add(`услуга ${part.sheet}`, part.kopecks);
      else if (op.breakdown) add(`остаток без составляющей у типа ${type}`, part.kopecks);
      else add(`тип ${type}`, part.kopecks);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Один алерт на загрузку; возвращает число операций без статьи. */
export async function reportOzonUnknownArticles(
  errors: Pick<ErrorReporter, 'report'>,
  ops: readonly IFinanceOperationRow[],
  telegramUserId: string,
): Promise<number> {
  const groups = ozonUnknownGroups(ops);
  if (groups.length) {
    const lines = groups.map(
      (g) => `${g.signature}: ${g.count} шт., ${kopecksToRub(g.amountKopecks)} ₽`,
    );
    await errors.report({
      error: new OzonUnknownArticleError(
        `Журнал Ozon: операции без статьи — допишите правило в ozon-articles.ts\n${lines.join('\n')}`,
      ),
      source: 'queue',
      context: OZON_UNKNOWN_ARTICLE_CONTEXT,
      telegramUserId,
    });
  }
  return ops.filter((op) => op.article === 'unknown').length;
}
