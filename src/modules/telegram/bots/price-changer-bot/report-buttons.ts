import type { TPeriodKey } from '../../../yandex/reports/report-period';
import type { TReportKey } from '../../../yandex/reports/report-status-map';

import { REPORT } from '../../../yandex/reports/report-status-map';

import { MENU } from './menu.constants';

/**
 * Связь кнопок с отчётами: подпись меню → ключ отчёта, формат callback_data
 * кнопок периода и раздела рассылки.
 *
 * Почему отдельный модуль, а не место в хендлерах, где всё это жило раньше.
 * Формат callback_data нужен ДВУМ сторонам — тому, кто рисует кнопку, и тому,
 * кто разбирает нажатие, — и это ровно та пара, что молча разъезжается
 * (см. menu.constants.ts). А с появлением пофичного доступа появился третий
 * читатель — `features.domain.ts`, который обязан остаться чистым: импорт из
 * хендлера втянул бы в него Nest и telegraf, и юнит-тест реестра фич поднимал
 * бы половину приложения.
 *
 * Здесь нет ни telegraf, ни Nest, ни Mongo — только константы и разбор строк.
 */

/** Кнопка меню → отчёт. Единственное место, где они связаны. */
export const MENU_TO_REPORT: Readonly<Record<string, TReportKey>> = {
  [MENU.SHIPPED_TODAY]: REPORT.SHIPPED_TODAY,
  [MENU.REDEEMED]: REPORT.REDEEMED,
  [MENU.RETURNING]: REPORT.RETURNING,
  [MENU.IN_TRANSIT]: REPORT.IN_TRANSIT,
  [MENU.PROFIT]: REPORT.PROFIT,
  [MENU.TARIFF_CALC]: REPORT.TARIFF_CALC,
};

/** Ключ отчёта, пришедший из callback_data, — данные извне, а не наш тип. */
export function isReportKey(value: string | undefined): value is TReportKey {
  return (Object.values(REPORT) as string[]).includes(value ?? '');
}

// --- кнопки выбора периода отчёта -------------------------------------------
//
// Лимит Telegram на callback_data — 64 байта; самое длинное здесь
// `rep:month:shipped_today` — 23.

export const REPORT_CB_PATTERN = /^rep:(today|day|week|month|all):([a-z_]+)$/;

export function reportCallback(period: TPeriodKey, reportKey: TReportKey): string {
  return `rep:${period}:${reportKey}`;
}

export function parseReportCallback(
  data: string | undefined,
): { period: TPeriodKey; reportKey: TReportKey } | null {
  const match = REPORT_CB_PATTERN.exec(data ?? '');
  if (!match || !isReportKey(match[2])) return null;
  return { period: match[1] as TPeriodKey, reportKey: match[2] };
}

// --- кнопки раздела рассылки -------------------------------------------------

export type TScheduleAction = 'menu' | 'on' | 'off' | 'time' | 'period';

export const SCHEDULE_CB_PATTERN = /^sch:(menu|on|off|time|period):([a-z_]*)$/;

export function scheduleCallback(action: TScheduleAction, reportKey = ''): string {
  return `sch:${action}:${reportKey}`;
}

/**
 * Разбор кнопки рассылки. `reportKey` может отсутствовать: `sch:menu:` — это
 * возврат в раздел, он ни к какому отчёту не относится.
 */
export function parseScheduleCallback(
  data: string | undefined,
): { action: TScheduleAction; reportKey: TReportKey | null } | null {
  const match = SCHEDULE_CB_PATTERN.exec(data ?? '');
  if (!match) return null;
  return {
    action: match[1] as TScheduleAction,
    reportKey: isReportKey(match[2]) ? match[2] : null,
  };
}
