import { JOB_TYPES } from '../../index';

/**
 * Идентификатор повторяемой задачи рассылки отчёта (TASK-157) — чистые
 * правила, без Nest и Redis. Собирает ReportSchedulerService, разбирает и он
 * (сверка), и страница очередей (`QueuesService.digests`).
 */

export interface IReportJobKey {
  botId: string;
  telegramUserId: string;
  reportKey: string;
}

/**
 * Дефис, а не двоеточие — та же болезнь, что вылечена у `finance-<id>` в
 * TASK-112. Bull склеивает ключ повторяемой задачи как
 * `name:jobId:endDate:tz:cron` и в `getRepeatableJobs` режет его по `:`
 * (lib/repeatable.js, `_keyToData`). С прежним `report:<bot>:<user>:<key>` он
 * отдавал id `report` и cron `<bot>`: сверка не узнавала ни одной задачи и на
 * каждом старте пересоздавала все, а таблица «Рассылки» в панели была пуста.
 */
export const REPORT_JOB_PREFIX = 'report-';

/**
 * Разбор с конца: ключ отчёта (`[a-z_]`, дефиса в ключах REPORT нет) —
 * последний сегмент, Telegram id — цифры перед ним, бот — всё остальное.
 * Именно так, а не split('-'): у бота-заглушки без базы id `no-database`.
 */
const REPORT_JOB_ID = /^report-(.+)-(\d+)-([a-z0-9_]+)$/;

/**
 * jobId выводится из пользователя, бота и отчёта и стабилен между запусками:
 * случайный означал бы ВТОРУЮ задачу при повторном включении и отчёт дважды в день.
 */
export function reportJobId(key: IReportJobKey): string {
  return `${REPORT_JOB_PREFIX}${key.botId}-${key.telegramUserId}-${key.reportKey}`;
}

/** Обратное к reportJobId; чужой (и старый `report:…`) id — null. */
export function parseReportJobId(id: unknown): IReportJobKey | null {
  if (typeof id !== 'string') return null;
  const match = REPORT_JOB_ID.exec(id);
  if (!match) return null;
  const [, botId, telegramUserId, reportKey] = match;
  return { botId, telegramUserId, reportKey };
}

/**
 * Ключ задачи в старом формате. Узнать её можно ТОЛЬКО по key: id Bull
 * отдаёт `report`. Без `key` (заглушки) — не старая.
 */
const LEGACY_KEY_PREFIX = `${JOB_TYPES.SEND_SCHEDULED_REPORT}:report:`;

export function isLegacyReportJobKey(key: unknown, of?: IReportJobKey): boolean {
  if (typeof key !== 'string') return false;
  if (!of) return key.startsWith(LEGACY_KEY_PREFIX);
  return key.startsWith(`${LEGACY_KEY_PREFIX}${of.botId}:${of.telegramUserId}:${of.reportKey}:`);
}
