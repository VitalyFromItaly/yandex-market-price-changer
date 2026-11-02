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

export type EventMarketplace = 'ym' | 'ozon';

export interface PushEventTargetResponse {
  marketplace: string;
  title: string;
  url: string | null;
  steps: string[];
  lastEventAt: string | null;
}

export interface PushEventsResponse {
  about: string;
  unavailable: string | null;
  targets: PushEventTargetResponse[];
}

/** Адрес уведомлений площадки — только по подключённой площадке. */
export interface PushEventTarget {
  marketplace: EventMarketplace;
  title: string;
  url: string | null;
  steps: string[];
  /** «14:30» / «24-09-2026 14:30» по Москве; null — уведомлений ещё не было. */
  lastEventLabel: string | null;
}

export interface PushEvents {
  about: string;
  unavailable: string | null;
  targets: PushEventTarget[];
}

export interface PushScheduleResponse {
  interval: string;
  intervalLabel: string;
  options: { value: string; label: string }[];
  about: string[];
  nextRunAt: string | null;
  lastRun: { at: string; ok: boolean; summary: string } | null;
  events?: PushEventsResponse;
}

export interface PushSchedule {
  interval: PushInterval;
  intervalLabel: string;
  options: { value: PushInterval; label: string }[];
  about: string[];
  /** «14:30» или «24-09-2026 14:30» по Москве; null — запуска не будет. */
  nextRunLabel: string | null;
  lastRun: { atLabel: string; ok: boolean; summary: string } | null;
  /** null — синхронизация по заказу закрыта администратором. */
  events: PushEvents | null;
}

/** Подписка на уведомления Ozon, поставленная через Seller API. Текст — с сервера. */
export interface OzonPushStatus {
  state: 'connected' | 'occupied' | 'none' | 'error';
  ok: boolean;
  text: string;
}
