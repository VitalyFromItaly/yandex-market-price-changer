import type { TFeatureMap } from '../../bots/shared/features.domain';

import { stockPushWriteOpen } from '../../../stock-push/stock-push.service';
import { FEATURE, isFeatureEnabled } from '../../bots/shared/features.domain';

/**
 * Расписание «Передачи остатков» (TASK-176) — чистые правила, без Nest и Redis.
 * Доступ к данным и Redis — StockPushScheduler.
 */

/**
 * Каждые 30 минут по Москве, круглосуточно (решение `stock_push_schedule_every_30m`):
 * продажа на одной площадке доходит до остальных за полчаса, а чтение заказов и
 * остатков всех площадок продавца не упирается в квоты.
 */
export const PUSH_CRON = '*/30 * * * *';

/**
 * Префикс id повторяемых задач: сверка трогает ТОЛЬКО их — очередь общая с
 * прайсом. Дефис, а не двоеточие — Bull режет ключ повторяемой задачи по `:`
 * (довод FINANCE_JOB_PREFIX).
 */
export const PUSH_JOB_PREFIX = 'stockpush-';

/** Разовый проход по кнопке панели: свой префикс, сверка расписания его не узнаёт. */
export const PUSH_NOW_JOB_PREFIX = 'stockpushnow-';

/**
 * Проход сразу после прайса из бота (решение `stock_push_after_bot_price_list`):
 * свой префикс — сверка расписания его не узнаёт, а «Запустить сейчас» панели
 * не склеивается с ним.
 */
export const PUSH_AFTER_PRICE_LIST_JOB_PREFIX = 'stockpushfile-';

export function pushAfterPriceListJobId(telegramUserId: string): string {
  return `${PUSH_AFTER_PRICE_LIST_JOB_PREFIX}${telegramUserId}`;
}

export function pushJobId(telegramUserId: string): string {
  return `${PUSH_JOB_PREFIX}${telegramUserId}`;
}

export function pushNowJobId(telegramUserId: string): string {
  return `${PUSH_NOW_JOB_PREFIX}${telegramUserId}`;
}

/** Обратное к pushJobId; чужой id (и разовые `stockpushnow-`/`stockpushfile-`) — null. */
export function parsePushJobId(id: string | null | undefined): string | null {
  if (!id?.startsWith(PUSH_JOB_PREFIX)) return null;
  const telegramUserId = id.slice(PUSH_JOB_PREFIX.length);
  return /^\d+$/.test(telegramUserId) ? telegramUserId : null;
}

export interface IPushCandidate {
  telegramUserId: string;
  status: string;
  features?: TFeatureMap;
}

/**
 * Кому положен проход: одобренные с открытой `stock_push_schedule` (её
 * `requires` — `stock_push` — решает `isFeatureEnabled`) и хоть одной открытой
 * записью площадки — без неё проходу нечего писать. Админы сюда не входят:
 * строки доступа у них нет, а автоматическая запись в кабинет — только по
 * решению владельца о конкретном продавце. Строк у продавца несколько (боты) —
 * берётся первая подходящая.
 *
 * `requireSchedule: false` — проход после прайса из бота: продавец сам прислал
 * файл, поэтому хватает `stock_push` и открытой записи площадки.
 */
export function pickPushUsers(
  accounts: readonly IPushCandidate[],
  { requireSchedule = true }: { requireSchedule?: boolean } = {},
): Map<string, TFeatureMap> {
  const gate = requireSchedule ? FEATURE.STOCK_PUSH_SCHEDULE : FEATURE.STOCK_PUSH;
  const result = new Map<string, TFeatureMap>();
  for (const account of accounts) {
    const id = account.telegramUserId;
    if (account.status !== 'approved' || result.has(id)) continue;
    const features = account.features ?? {};
    if (isFeatureEnabled(features, gate) && stockPushWriteOpen(features)) {
      result.set(id, features);
    }
  }
  return result;
}
