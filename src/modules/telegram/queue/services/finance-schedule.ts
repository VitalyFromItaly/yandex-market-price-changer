import type { TFinanceMarketplace } from '../../../../database/postgres/finance.schema';
import type { TFeatureMap } from '../../bots/shared/features.domain';

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
  configured: { ym: ReadonlySet<string>; ozon: ReadonlySet<string>; wb: ReadonlySet<string> },
): Map<string, TFinanceMarketplace[]> {
  const result = new Map<string, TFinanceMarketplace[]>();
  const add = (id: string, marketplace: TFinanceMarketplace) =>
    result.set(id, [...(result.get(id) ?? []), marketplace]);

  for (const id of pickFinanceUsers(accounts, adminIds, configured.ym)) add(id, 'ym');

  // Ozon и WB: подключённый ключ плюс фичи `finance` и площадки; админ — без флагов.
  const byFeature = [
    ['ozon', FEATURE.OZON],
    ['wb', FEATURE.WB],
  ] as const;
  for (const [marketplace, feature] of byFeature) {
    const wanted = new Set<string>(adminIds.map(String));
    for (const account of accounts) {
      if (
        account.status === 'approved' &&
        isFeatureEnabled(account.features, FEATURE.FINANCE) &&
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
