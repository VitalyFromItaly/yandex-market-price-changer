/**
 * Синхронизация остатков между площадками — частота прохода «Передачи
 * остатков» по расписанию (решение `stock_push_interval_by_seller`). Фичу
 * `stock_push_schedule` открывает администратор, частоту выбирает продавец.
 * Тексты и варианты приходят с сервера — один источник для «Прайса» и «Настроек».
 */

export const STOCK_PUSH_SCHEDULE_FEATURE = 'stock_push_schedule';

/** С одной площадкой чужих продаж нет — синхронизировать нечего. */
export const PUSH_SCHEDULE_MIN_MARKETPLACES = 2;

export type PushInterval = 'off' | '30m' | '1h' | '3h' | '6h';

export interface PushScheduleResponse {
  interval: string;
  intervalLabel: string;
  options: { value: string; label: string }[];
  about: string[];
  nextRunAt: string | null;
  lastRun: { at: string; ok: boolean; summary: string } | null;
}

export interface PushSchedule {
  interval: PushInterval;
  intervalLabel: string;
  options: { value: PushInterval; label: string }[];
  about: string[];
  /** «14:30» или «24-09-2026 14:30» по Москве; null — запуска не будет. */
  nextRunLabel: string | null;
  lastRun: { atLabel: string; ok: boolean; summary: string } | null;
}
