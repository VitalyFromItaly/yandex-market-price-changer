import type { TFeatureMap } from '../../bots/shared/features.domain';

import { toCron } from '../../../yandex/reports/schedule-time';
import { FEATURE, isFeatureEnabled } from '../../bots/shared/features.domain';

/**
 * Расписание проверки уведомлений (TASK-152) — чистые правила, без Nest и Redis.
 * Доступ к данным и Redis — SellerNotificationsScheduler.
 */

/**
 * Префикс id повторяемых задач: сверка трогает ТОЛЬКО их. Дефис, а не
 * двоеточие — Bull режет ключ повторяемой задачи по `:` (довод FINANCE_JOB_PREFIX).
 */
export const NOTIFY_JOB_PREFIX = 'notify-';

/** Разовая проверка по кнопке CRM: свой префикс, сверка расписания её не узнаёт. */
export const NOTIFY_NOW_JOB_PREFIX = 'notifynow-';

export function notifyJobId(telegramUserId: string): string {
  return `${NOTIFY_JOB_PREFIX}${telegramUserId}`;
}

export function notifyNowJobId(telegramUserId: string): string {
  return `${NOTIFY_NOW_JOB_PREFIX}${telegramUserId}`;
}

/** Обратное к notifyJobId; чужой id — null. */
export function parseNotifyJobId(id: string | null | undefined): string | null {
  if (!id?.startsWith(NOTIFY_JOB_PREFIX)) return null;
  const telegramUserId = id.slice(NOTIFY_JOB_PREFIX.length);
  return /^\d+$/.test(telegramUserId) ? telegramUserId : null;
}

/**
 * Cron продавца — его время «ЧЧ:ММ» по Москве (решение
 * `notifications_daily_seller_time`). Битое время в базе — умолчание, а не
 * падение сверки всех продавцов.
 */
export function notifyCron(time: string | undefined, fallback: string): string {
  try {
    return toCron(time ?? fallback);
  } catch {
    return toCron(fallback);
  }
}

export interface INotifyCandidate {
  telegramUserId: string;
  status: string;
  features?: TFeatureMap;
}

/**
 * Кому положена ежедневная проверка: одобренные с открытой `notifications`
 * (её `requires` — `finance` — решает `isFeatureEnabled`). Админы сюда не
 * входят (решение `notifications_admins_not_auto`): строки доступа у них нет,
 * флаги они обходят, и авторассылка без согласия была бы спамом. Строк у
 * продавца несколько (боты) — берётся первая подходящая: фичи у них общие
 * по смыслу, а проверка одна на продавца.
 */
export function pickNotificationUsers(
  accounts: readonly INotifyCandidate[],
): Map<string, TFeatureMap> {
  const result = new Map<string, TFeatureMap>();
  for (const account of accounts) {
    if (account.status !== 'approved' || result.has(account.telegramUserId)) continue;
    const features = account.features ?? {};
    if (isFeatureEnabled(features, FEATURE.NOTIFICATIONS)) {
      result.set(account.telegramUserId, features);
    }
  }
  return result;
}
