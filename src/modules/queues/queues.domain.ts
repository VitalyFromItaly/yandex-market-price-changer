import type { IReportDefinition } from '../yandex/reports/report-status-map';

import { QUEUE_NAMES } from '../telegram';
import { REPORT_DEFINITIONS } from '../yandex/reports/report-status-map';

/**
 * Чистая логика страницы очередей: без Nest и без Bull, по образцу
 * action-log.domain.ts — решения о том, что можно показать администратору,
 * живут в одном месте и проверяются юнит-тестами без инфраструктуры.
 */

export const QUEUE_LIST: readonly string[] = Object.values(QUEUE_NAMES);

/** Имя очереди приходит из браузера — только по списку, как isFeatureKey. */
export function isQueueName(value: unknown): value is string {
  return typeof value === 'string' && QUEUE_LIST.includes(value);
}

export const JOB_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;

export type TJobState = (typeof JOB_STATES)[number];

export function isJobState(value: unknown): value is TJobState {
  return typeof value === 'string' && (JOB_STATES as readonly string[]).includes(value);
}

/**
 * Псевдозначение фильтров «все очереди» / «все состояния». Именно значение, а
 * не отсутствие параметра: пустой параметр неотличим от забытого.
 */
export const FILTER_ALL = 'all';

/**
 * Скалярные поля payload'а, разрешённые к показу. Payload'ы трёх очередей из
 * четырёх несут botToken, поэтому здесь БЕЛЫЙ список, а не маскирование:
 * regex, пропустивший новое секретное поле, промолчит, а белый список
 * ошибается в безопасную сторону — новое поле просто не показывается.
 */
const SAFE_DATA_KEYS = [
  'telegramUserId',
  'userId',
  'botId',
  'chatId',
  'reportKey',
  'sessionId',
  'step',
  // Джоба sync-stocks: имя файла лежит в корне payload'а (не во fileInfo).
  'fileName',
] as const;

/**
 * Проекция payload'а задачи для ответа панели.
 *
 * Кроме секретов отсекаются и многотысячные блобы (`parsingResult`,
 * `yandexApiResult`): им в HTTP-ответе делать нечего. Из `fileInfo`
 * достаётся только имя файла.
 */
export function safeJobData(data: unknown): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  if (typeof data !== 'object' || data === null) return result;

  const source = data as Record<string, unknown>;
  for (const key of SAFE_DATA_KEYS) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') result[key] = value;
  }

  const fileInfo = source.fileInfo;
  if (typeof fileInfo === 'object' && fileInfo !== null) {
    const fileName = (fileInfo as Record<string, unknown>).fileName;
    if (typeof fileName === 'string') result.fileName = fileName;
  }

  return result;
}

export interface IParsedReportJobId {
  botId: string;
  telegramUserId: string;
  reportKey: string;
}

/**
 * Обратная к ReportSchedulerService.jobId(): `report:<botId>:<userId>:<key>`.
 * Не подходящие под формат идентификаторы — не ошибка, а чужие задачи.
 */
export function parseReportJobId(id: unknown): IParsedReportJobId | null {
  if (typeof id !== 'string') return null;
  const parts = id.split(':');
  if (parts.length !== 4 || parts[0] !== 'report') return null;
  const [, botId, telegramUserId, reportKey] = parts;
  if (!botId || !telegramUserId || !reportKey) return null;
  return { botId, telegramUserId, reportKey };
}

/** Обратная к toCron() из schedule-time.ts: `30 9 * * *` → «09:30». */
export function cronToTime(cron: unknown): string | null {
  if (typeof cron !== 'string') return null;
  const match = cron.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const hours = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Название отчёта для строки рассылки. Неизвестный ключ показывается как есть:
 * осиротевшее расписание — ровно то, что администратор хочет увидеть.
 */
export function reportTitleOf(reportKey: string): string {
  const definitions = REPORT_DEFINITIONS as Record<string, IReportDefinition | undefined>;
  return definitions[reportKey]?.title ?? reportKey;
}
