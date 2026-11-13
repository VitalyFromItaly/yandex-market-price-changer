import type { TFinanceMarketplace } from '../../../../database/postgres/finance.schema';
import type { TFeatureKey, TFeatureMap } from '../../bots/shared/features.domain';

import { FEATURE, isFeatureEnabled } from '../../bots/shared/features.domain';

/**
 * Расписание загрузки финансов (TASK-112) — чистые правила, без Nest и Redis.
 * Доступ к данным и Redis — FinanceImportScheduler.
 */

/**
 * Префикс id повторяемых задач загрузки: сверка трогает ТОЛЬКО их.
 *
 * Дефис, а не двоеточие: Bull склеивает ключ повторяемой задачи как
 * `name:jobId:endDate:tz:cron` и в `getRepeatableJobs` режет его по `:`
 * (lib/repeatable.js, `_keyToData`). С id `finance:111` он вернул бы id
 * `finance` и cron `Europe/Moscow` — сверка не узнала бы ни одной своей задачи
 * и на каждом старте заводила бы их заново. Поймано живым Redis, не тестом:
 * заглушка очереди хранит id как есть.
 */
export const FINANCE_JOB_PREFIX = 'finance-';

/**
 * jobId — из продавца, не случайный: случайный означал бы вторую задачу на
 * каждом рестарте (довод `ReportSchedulerService.jobId`).
 */
export function financeJobId(telegramUserId: string): string {
  return `${FINANCE_JOB_PREFIX}${telegramUserId}`;
}

/** Обратное к financeJobId; чужой id — null. */
export function parseFinanceJobId(id: string | null | undefined): string | null {
  if (!id?.startsWith(FINANCE_JOB_PREFIX)) return null;
  const telegramUserId = id.slice(FINANCE_JOB_PREFIX.length);
  return telegramUserId || null;
}

/**
 * Ночной cron продавца: 03:00–05:59 МСК, время — от хэша id.
 *
 * Не одна минута на всех: у united-netting квота 100 генераций в час, и
 * десяток продавцов в 03:00 стоял бы в очереди Маркета разом. От хэша, а не
 * от порядка в списке: время продавца не должно сдвигаться оттого, что
 * кому-то другому открыли фичу (иначе каждая сверка переставляла бы задачи).
 */
export function financeCron(telegramUserId: string): string {
  let hash = 0;
  for (const char of telegramUserId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const minute = hash % 60;
  const hour = 3 + (Math.floor(hash / 60) % 3);
  return `${minute} ${hour} * * *`;
}

export interface IFinanceCandidate {
  telegramUserId: string;
  status: string;
  features?: TFeatureMap;
}

/**
 * Кому ставить загрузку: одобренным с открытой фичей `finance` и админам из
 * TELEGRAM_ADMIN_IDS (решение `finance_schedule_admins`: флаги на админа не
 * действуют — у него и записи UserAccess нет) — и только с подключённым
 * магазином: без кредов импорт упадёт, а квоту съест сверка, а не данные.
 *
 * Записей доступа у продавца может быть несколько (по одной на бота) — хватит
 * одной подходящей: магазин и журнал ключуются по telegramUserId.
 */
export function pickFinanceUsers(
  accounts: readonly IFinanceCandidate[],
  adminIds: readonly (number | string)[],
  configured: ReadonlySet<string>,
): string[] {
  const wanted = new Set<string>(adminIds.map(String));
  for (const account of accounts) {
    if (account.status === 'approved' && isFeatureEnabled(account.features, FEATURE.FINANCE)) {
      wanted.add(account.telegramUserId);
    }
  }
  return [...wanted].filter((id) => configured.has(id)).sort();
}

/**
 * Площадки ночной загрузки по продавцам (TASK-131). ЯМ — прежнее правило
 * `pickFinanceUsers`, слово в слово. Ozon — подключённый ключ плюс фичи
 * `finance` И `ozon` (админу — без флагов, `finance_schedule_admins`): журнал
 * Ozon — часть финансов, а площадка у продавца закрыта своей фичей. WB
 * (TASK-136) — то же правило с фичей `wb`. Порядок площадок у продавца — ЯМ,
 * Ozon, WB: квоты у них разные, а ЯМ — то, что продавец уже видит на экранах.
 */
export function pickFinanceMarketplaces(
  accounts: readonly IFinanceCandidate[],
  adminIds: readonly (number | string)[],
  configured: IFinanceConfigured,
): Map<string, TFinanceMarketplace[]> {
  return pickMarketplacesBy(FEATURE.FINANCE, accounts, adminIds, configured);
}

/**
 * Площадки «Финучёта» (TASK-212): то же правило, что `pickFinanceMarketplaces`,
 * но вместо фичи `finance` — зонтик `fin_accounting` (он `finance` не требует:
 * новый учёт читает тот же журнал, и без загрузки ему нечего показать). Таким
 * продавцам ночной проход грузит окно перезагрузки, а частая задача — текущий
 * месяц ЯМ и Ozon. Планировщик зовёт её без админов: авторасписание без
 * согласия — довод `notifications_admins_not_auto`.
 */
export function pickAccountingMarketplaces(
  accounts: readonly IFinanceCandidate[],
  adminIds: readonly (number | string)[],
  configured: IFinanceConfigured,
): Map<string, TFinanceMarketplace[]> {
  return pickMarketplacesBy(FEATURE.FIN_ACCOUNTING, accounts, adminIds, configured);
}

/** Объединение площадок по продавцам, порядок площадок — ЯМ, Ozon, WB. */
export function mergeMarketplaceMaps(
  ...maps: readonly ReadonlyMap<string, readonly TFinanceMarketplace[]>[]
): Map<string, TFinanceMarketplace[]> {
  const order: readonly TFinanceMarketplace[] = ['ym', 'ozon', 'wb'];
  const result = new Map<string, Set<TFinanceMarketplace>>();
  for (const map of maps) {
    for (const [id, list] of map) {
      const set = result.get(id) ?? new Set<TFinanceMarketplace>();
      list.forEach((marketplace) => set.add(marketplace));
      result.set(id, set);
    }
  }
  return new Map(
    [...result.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, set]) => [id, order.filter((marketplace) => set.has(marketplace))]),
  );
}

export interface IFinanceConfigured {
  ym: ReadonlySet<string>;
  ozon: ReadonlySet<string>;
  wb: ReadonlySet<string>;
}

function pickMarketplacesBy(
  base: TFeatureKey,
  accounts: readonly IFinanceCandidate[],
  adminIds: readonly (number | string)[],
  configured: IFinanceConfigured,
): Map<string, TFinanceMarketplace[]> {
  const result = new Map<string, TFinanceMarketplace[]>();
  const add = (id: string, marketplace: TFinanceMarketplace) =>
    result.set(id, [...(result.get(id) ?? []), marketplace]);

  const ymWanted = new Set<string>(adminIds.map(String));
  for (const account of accounts) {
    if (account.status === 'approved' && isFeatureEnabled(account.features, base)) {
      ymWanted.add(account.telegramUserId);
    }
  }
  for (const id of [...ymWanted].filter((candidate) => configured.ym.has(candidate)).sort()) {
    add(id, 'ym');
  }

  // Ozon и WB: подключённый ключ плюс базовая фича и фича площадки; админ — без флагов.
  const byFeature = [
    ['ozon', FEATURE.OZON],
    ['wb', FEATURE.WB],
  ] as const;
  for (const [marketplace, feature] of byFeature) {
    const wanted = new Set<string>(adminIds.map(String));
    for (const account of accounts) {
      if (
        account.status === 'approved' &&
        isFeatureEnabled(account.features, base) &&
        isFeatureEnabled(account.features, feature)
      ) {
        wanted.add(account.telegramUserId);
      }
    }
    for (const id of [...wanted]
      .filter((candidate) => configured[marketplace].has(candidate))
      .sort()) {
      add(id, marketplace);
    }
  }

  return new Map([...result.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Префикс частой задачи «Финучёта» (TASK-212). Свой, не `finance-`: сверка
 * ночного расписания снимает всё `finance-*`, чего нет в её списке, — и сняла
 * бы частые задачи на каждом старте. Дефис — довод `FINANCE_JOB_PREFIX`.
 */
export const ACCOUNTING_JOB_PREFIX = 'finacc-';

export function accountingJobId(telegramUserId: string): string {
  return `${ACCOUNTING_JOB_PREFIX}${telegramUserId}`;
}

export function parseAccountingJobId(id: string | null | undefined): string | null {
  if (!id?.startsWith(ACCOUNTING_JOB_PREFIX)) return null;
  const telegramUserId = id.slice(ACCOUNTING_JOB_PREFIX.length);
  return telegramUserId || null;
}

/**
 * Площадки частой загрузки текущего месяца (решение
 * `accounting_sync_frequent_3h`): ЯМ и Ozon. У WB новый отчёт реализации раз в
 * неделю — чаще ночи его опрашивать незачем (матрица TASK-205).
 */
export const ACCOUNTING_FREQUENT_MARKETPLACES: ReadonlySet<TFinanceMarketplace> = new Set([
  'ym',
  'ozon',
]);

/**
 * Cron частой задачи: раз в `everyHours` часов, минута — от хэша id (довод
 * `financeCron`: продавцы не стоят в квоте Маркета разом, а минута не
 * сдвигается оттого, что фичу открыли кому-то ещё).
 */
export function accountingCron(telegramUserId: string, everyHours: number): string {
  let hash = 0;
  for (const char of telegramUserId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const minute = hash % 60;
  const hours = Math.min(12, Math.max(1, Math.floor(everyHours)));
  return hours === 1 ? `${minute} * * * *` : `${minute} */${hours} * * *`;
}

/**
 * Префикс отложенного повтора после сбоя загрузки периода (TASK-212). Номер
 * повтора — в id: повтор ставится, пока предыдущая задача с тем же периодом
 * ещё активна, и одинаковый id Bull молча не поставил бы.
 */
export const FINANCE_RETRY_JOB_PREFIX = 'finretry-';

export function financeRetryJobId(
  telegramUserId: string,
  marketplace: TFinanceMarketplace,
  month: string,
  attempt: number,
): string {
  return `${FINANCE_RETRY_JOB_PREFIX}${marketplace}-${telegramUserId}-${month}-${attempt}`;
}

/**
 * Префикс разовых загрузок по кнопке CRM («Загрузить из Маркета»). НЕ `finance-`:
 * сверка расписания и карточка «Очереди» узнают свои задачи по `finance-` —
 * разовая задача там читалась бы как продавец `pull-…`. Дефис — довод выше.
 */
export const FINANCE_PULL_JOB_PREFIX = 'finpull-';

/**
 * Не чаще раза в 15 минут на месяц: у united-netting квота 100 генераций в час
 * на кабинет, её делят ночной проход и все кнопки продавца.
 */
export const FINANCE_PULL_COOLDOWN_MS = 15 * 60_000;

/**
 * id разовой загрузки — из продавца, площадки и месяца: двойной клик, пока
 * задача ждёт или идёт, Bull второй не ставит.
 */
export function financePullJobId(
  telegramUserId: string,
  marketplace: TFinanceMarketplace,
  month: string,
): string {
  return `${FINANCE_PULL_JOB_PREFIX}${marketplace}-${telegramUserId}-${month}`;
}

/**
 * До какого момента месяц нельзя грузить снова; null — можно сейчас. Отсчёт —
 * от последней попытки (`finance_periods.checked_at`), и неудачной тоже: сбой
 * Маркета повтором через минуту не лечится, а квоту жжёт.
 */
export function financePullCooldownUntil(lastAttemptAt: Date | null, now: Date): Date | null {
  if (!lastAttemptAt) return null;
  const until = new Date(lastAttemptAt.getTime() + FINANCE_PULL_COOLDOWN_MS);
  return until > now ? until : null;
}
