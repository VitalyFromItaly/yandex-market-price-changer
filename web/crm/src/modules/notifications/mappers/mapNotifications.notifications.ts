import type {
  NotificationItem,
  NotificationResponse,
  NotificationSettings,
  NotificationSettingsResponse,
  NotificationsFeed,
  NotificationsResponse,
  RulesForm,
  SettingsBody,
  SettingsErrors,
  ThresholdUnit,
} from '../notifications.domain';

import { INVALID_SETTING } from '../notifications.domain';

import { ApiError } from '@/shared/http';
import { formatSavedAt } from '@/shared/utils';

export const UNIT_LABEL: Record<ThresholdUnit, string> = {
  percent: '%',
  points: 'п.п.',
  units: 'шт.',
  days: 'дн.',
  rub: '₽',
};

export function mapNotification(row: NotificationResponse, now?: Date): NotificationItem {
  return {
    id: row.id,
    ruleLabel: row.ruleLabel,
    marketplaceLabel: row.marketplaceLabel,
    title: row.title,
    body: row.body,
    active: row.active,
    read: row.read,
    createdLabel: row.createdAt === null ? null : formatSavedAt(row.createdAt, now),
    sentToTelegram: row.sentAt !== null,
  };
}

export function mapFeed(response: NotificationsResponse, now?: Date): NotificationsFeed {
  return {
    items: response.items.map((row) => mapNotification(row, now)),
    total: response.total,
    unread: response.unread,
  };
}

export function mapSettings(response: NotificationSettingsResponse): NotificationSettings {
  return {
    telegramAvailable: response.telegramAvailable,
    telegram: response.telegram,
    time: response.time,
    rules: response.rules.map((rule) => ({
      ...rule,
      unitLabel: rule.unit === null ? null : UNIT_LABEL[rule.unit],
    })),
  };
}

export function toRulesForm(settings: NotificationSettings): RulesForm {
  const form: RulesForm = {};
  for (const rule of settings.rules) {
    form[rule.key] = {
      enabled: rule.enabled,
      threshold: rule.threshold === null ? '' : String(rule.threshold),
    };
  }
  return form;
}

/**
 * Что изменилось в форме правил — только это уходит на сервер. Порог —
 * числом, если читается как число, иначе строкой как есть: проверяет сервер
 * (одно правило на бота и CRM), ошибка встанет под поле.
 */
export function rulesDiff(settings: NotificationSettings, form: RulesForm): SettingsBody {
  const rules: NonNullable<SettingsBody['rules']> = {};
  for (const rule of settings.rules) {
    const row = form[rule.key];
    if (row === undefined) continue;
    const change: { enabled?: boolean; threshold?: number | string } = {};
    if (row.enabled !== rule.enabled) change.enabled = row.enabled;
    if (rule.unit !== null) {
      const raw = row.threshold.trim().replace(',', '.').replace(/\s/g, '');
      const saved = rule.threshold === null ? '' : String(rule.threshold);
      if (raw !== saved)
        change.threshold = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    }
    if (Object.keys(change).length) rules[rule.key] = change;
  }
  return Object.keys(rules).length ? { rules } : {};
}

export function mapSettingsError(error: unknown, fallback: string): SettingsErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (error instanceof ApiError && error.code === INVALID_SETTING && error.field !== null) {
    return { [error.field]: message };
  }
  return { form: message };
}
