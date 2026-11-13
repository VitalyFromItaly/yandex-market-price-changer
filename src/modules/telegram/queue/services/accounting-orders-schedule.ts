import type { IFinanceCandidate } from './finance-schedule';
import type { TFinanceMarketplace } from '../../../../database/postgres/finance.schema';

import { pickAccountingMarketplaces } from './finance-schedule';

/**
 * Расписание снимка строк заказов «Финучёта» (TASK-210) — чистые правила.
 *
 * Префикс свой: сверка соседних расписаний снимает всё «своё», чего нет в её
 * списке. Дефис, не двоеточие — Bull режет ключ повторяемой задачи по `:`
 * (довод `FINANCE_JOB_PREFIX`).
 */
export const ACCOUNTING_ORDERS_JOB_PREFIX = 'accorders-';

export function accountingOrdersJobId(telegramUserId: string): string {
  return `${ACCOUNTING_ORDERS_JOB_PREFIX}${telegramUserId}`;
}

export function parseAccountingOrdersJobId(id: string | null | undefined): string | null {
  if (!id?.startsWith(ACCOUNTING_ORDERS_JOB_PREFIX)) return null;
  const telegramUserId = id.slice(ACCOUNTING_ORDERS_JOB_PREFIX.length);
  return /^\d+$/.test(telegramUserId) ? telegramUserId : null;
}

/**
 * Кому и по каким площадкам положен снимок: одобрен, открыт `fin_accounting`,
 * площадка настроена (ЯМ — магазин, Ozon/WB — ключ и фича площадки) — то же
 * правило, что у частой загрузки «Финучёта» (`pickAccountingMarketplaces`).
 * Админов нет (довод `notifications_admins_not_auto`): флаги они обходят, а
 * опрос без согласия жёг бы квоту их магазина.
 */
export function pickAccountingOrdersUsers(
  accounts: readonly IFinanceCandidate[],
  configured: Record<TFinanceMarketplace, ReadonlySet<string>>,
): Map<string, TFinanceMarketplace[]> {
  return pickAccountingMarketplaces(accounts, [], configured);
}

/**
 * Cron раз в `everyMinutes` минут со сдвигом от хэша id: продавцы не стоят в
 * квоте Маркета разом, а сдвиг не меняется оттого, что фичу открыли кому-то ещё.
 * Шаг — делитель часа (5, 10, 15, 20, 30), иначе слоты на стыке часа слипались бы.
 */
export function accountingOrdersCron(telegramUserId: string, everyMinutes: number): string {
  const steps = [5, 10, 15, 20, 30, 60];
  const step = steps.find((value) => value >= Math.floor(everyMinutes)) ?? 60;
  let hash = 0;
  for (const char of telegramUserId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const offset = hash % step;
  return step === 60 ? `${offset} * * * *` : `${offset}-59/${step} * * * *`;
}
