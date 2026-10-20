/**
 * «Уведомления» CRM (TASK-152): центр уведомлений и настройки правил. Правила,
 * пороги и тексты живут на бэкенде (`src/modules/notifications/`) — здесь
 * только показ и форма.
 */

export const NOTIFICATIONS_ROUTE_NAME = 'ym-notifications';
/** Фича отправки в Telegram — блок «Telegram» в настройках только с ней. */
export const NOTIFICATIONS_TELEGRAM_FEATURE = 'notifications_telegram';
/** Код сервера «значение не принято» — ошибка под поле. */
export const INVALID_SETTING = 'INVALID_SETTING';

export type NotificationsTabKey = 'feed' | 'settings';

export interface NotificationsTab {
  key: NotificationsTabKey;
  label: string;
}

export const NOTIFICATIONS_TABS: readonly NotificationsTab[] = [
  { key: 'feed', label: 'Лента' },
  { key: 'settings', label: 'Настройки' },
];

export type ThresholdUnit = 'percent' | 'points' | 'units' | 'days' | 'rub';

// ─── ответы API ──────────────────────────────────────────────────────────────

export interface NotificationResponse {
  id: string;
  rule: string;
  ruleLabel: string;
  marketplace: string | null;
  marketplaceLabel: string | null;
  title: string;
  body: string;
  active: boolean;
  read: boolean;
  createdAt: string | null;
  sentAt: string | null;
}

export interface NotificationsResponse {
  items: NotificationResponse[];
  total: number;
  unread: number;
}

export interface NotificationRuleResponse {
  key: string;
  label: string;
  description: string;
  unit: ThresholdUnit | null;
  enabled: boolean;
  threshold: number | null;
  min: number | null;
  max: number | null;
}

export interface NotificationSettingsResponse {
  telegramAvailable: boolean;
  telegram: boolean;
  time: string;
  rules: NotificationRuleResponse[];
}

// ─── домен ───────────────────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  ruleLabel: string;
  marketplaceLabel: string | null;
  title: string;
  body: string;
  active: boolean;
  read: boolean;
  /** «24-09-2026 14:32» по Москве; null — даты нет. */
  createdLabel: string | null;
  sentToTelegram: boolean;
}

export interface NotificationsFeed {
  items: NotificationItem[];
  total: number;
  unread: number;
}

export interface NotificationRule {
  key: string;
  label: string;
  description: string;
  unit: ThresholdUnit | null;
  /** «%», «п.п.», «шт.», «дн.», «₽»; null — порога нет. */
  unitLabel: string | null;
  enabled: boolean;
  threshold: number | null;
  min: number | null;
  max: number | null;
}

export interface NotificationSettings {
  telegramAvailable: boolean;
  telegram: boolean;
  time: string;
  rules: NotificationRule[];
}

/** Строка формы правила: порог — строкой поля ввода. */
export interface RuleFormRow {
  enabled: boolean;
  threshold: string;
}

export type RulesForm = Record<string, RuleFormRow>;

export interface SettingsBody {
  telegram?: boolean;
  time?: string;
  rules?: Record<string, { enabled?: boolean; threshold?: number | string }>;
}

/** Ошибки формы по ключу поля сервера (`rules.low_stock.threshold`, `time`) и `form`. */
export type SettingsErrors = Record<string, string>;
