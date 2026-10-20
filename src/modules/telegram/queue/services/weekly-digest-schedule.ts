import type { TFeatureMap } from '../../bots/shared/features.domain';

import { FEATURE, isFeatureEnabled } from '../../bots/shared/features.domain';

/**
 * Расписание еженедельной ИИ-сводки (TASK-168) — чистые правила, без Nest и Redis.
 * Доступ к данным и Redis — WeeklyDigestScheduler.
 */

/**
 * Понедельник, 10:00 по Москве. Понедельник — неделя пн–вс уже закрыта, а
 * ночная загрузка финансов (03:00–05:59) успела положить в журнал воскресенье;
 * 10:00 — продавец уже за работой, и до обеда есть время что-то поправить.
 */
export const DIGEST_CRON = '0 10 * * 1';

/**
 * Префикс id повторяемых задач: сверка трогает ТОЛЬКО их. Дефис, а не
 * двоеточие — Bull режет ключ повторяемой задачи по `:` (довод FINANCE_JOB_PREFIX).
 */
export const DIGEST_JOB_PREFIX = 'weeklydigest-';

/** Разовая отправка по кнопке панели: свой префикс, сверка расписания её не узнаёт. */
export const DIGEST_NOW_JOB_PREFIX = 'weeklydigestnow-';

export function digestJobId(telegramUserId: string): string {
  return `${DIGEST_JOB_PREFIX}${telegramUserId}`;
}

export function digestNowJobId(telegramUserId: string): string {
  return `${DIGEST_NOW_JOB_PREFIX}${telegramUserId}`;
}

/** Обратное к digestJobId; чужой id — null. */
export function parseDigestJobId(id: string | null | undefined): string | null {
  if (!id?.startsWith(DIGEST_JOB_PREFIX)) return null;
  const telegramUserId = id.slice(DIGEST_JOB_PREFIX.length);
  return /^\d+$/.test(telegramUserId) ? telegramUserId : null;
}

export interface IDigestCandidate {
  telegramUserId: string;
  status: string;
  features?: TFeatureMap;
}

/**
 * Кому положена сводка: одобренные с открытой `ai_weekly_digest` (её
 * `requires` — `ai` и `finance` — решает `isFeatureEnabled`) и подключённым
 * магазином ЯМ (`configured`): без него журнала нет, и задача только
 * записывала бы «нет данных». Админы сюда не входят (решение
 * `ai_weekly_digest_admins_manual`): строки доступа у них нет, флаги они
 * обходят, а авторассылка без согласия тратила бы лимит ИИ. Строк у продавца
 * несколько (боты) — берётся первая подходящая.
 */
export function pickDigestUsers(
  accounts: readonly IDigestCandidate[],
  configured: ReadonlySet<string>,
): Map<string, TFeatureMap> {
  const result = new Map<string, TFeatureMap>();
  for (const account of accounts) {
    const id = account.telegramUserId;
    if (account.status !== 'approved' || result.has(id) || !configured.has(id)) continue;
    const features = account.features ?? {};
    if (isFeatureEnabled(features, FEATURE.AI_WEEKLY_DIGEST)) result.set(id, features);
  }
  return result;
}
