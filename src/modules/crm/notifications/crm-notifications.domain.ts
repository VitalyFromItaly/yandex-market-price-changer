import type {
  ISellerNotificationSettings,
  ISellerNotificationSettingsPatch,
} from '../../../database/services/seller-notification-settings.service';
import type {
  ISellerNotificationPage,
  ISellerNotificationRow,
} from '../../../database/services/seller-notification.service';
import type {
  INotificationRuleSetting,
  TNotificationRule,
  TThresholdUnit,
} from '../../notifications/notifications.domain';

import { MARKETPLACE_LABEL, MARKETPLACES } from '../../../shared/marketplace';
import {
  NOTIFICATION_RULES,
  NOTIFICATION_RULE_KEYS,
  thresholdError,
} from '../../notifications/notifications.domain';
import { parseScheduleTime } from '../../yandex/reports/schedule-time';

/**
 * «Уведомления» CRM (TASK-152) — доставка: перечисление полей ответа и разбор
 * тела. Правила, пороги и тексты — `src/modules/notifications/`.
 */

/** 400: значение не принято; `field` — под каким полем ошибка. */
export const INVALID_SETTING = 'INVALID_SETTING';

export const PAGE_LIMIT_MAX = 100;

export interface ICrmNotificationView {
  id: string;
  rule: string;
  ruleLabel: string;
  marketplace: string | null;
  marketplaceLabel: string | null;
  title: string;
  body: string;
  /** Условие ещё держится; false — снято (состояние сменилось или пропало). */
  active: boolean;
  read: boolean;
  createdAt: string | null;
  sentAt: string | null;
}

export interface ICrmNotificationsView {
  items: ICrmNotificationView[];
  total: number;
  unread: number;
}

export interface ICrmNotificationRuleView {
  key: TNotificationRule;
  label: string;
  description: string;
  unit: TThresholdUnit | null;
  enabled: boolean;
  threshold: number | null;
  min: number | null;
  max: number | null;
}

export interface ICrmNotificationSettingsView {
  /** Отправка в Telegram открыта (`notifications_telegram`) — блок «Telegram» показывается. */
  telegramAvailable: boolean;
  telegram: boolean;
  /** «ЧЧ:ММ» по Москве. */
  time: string;
  rules: ICrmNotificationRuleView[];
}

const iso = (date: Date | null) => (date ? new Date(date).toISOString() : null);

function marketplaceLabel(marketplace: string | null): string | null {
  return MARKETPLACES.find((key) => key === marketplace)
    ? MARKETPLACE_LABEL[marketplace as (typeof MARKETPLACES)[number]]
    : null;
}

export function toCrmNotification(row: ISellerNotificationRow): ICrmNotificationView {
  return {
    id: row.id,
    rule: row.rule,
    ruleLabel: NOTIFICATION_RULES[row.rule as TNotificationRule]?.label ?? row.rule,
    marketplace: row.marketplace,
    marketplaceLabel: marketplaceLabel(row.marketplace),
    title: row.title,
    body: row.body,
    active: row.active,
    read: row.readAt !== null,
    createdAt: iso(row.createdAt),
    sentAt: iso(row.sentAt),
  };
}

export function toCrmNotifications(page: ISellerNotificationPage): ICrmNotificationsView {
  return { items: page.items.map(toCrmNotification), total: page.total, unread: page.unread };
}

export function toCrmNotificationSettings(
  settings: ISellerNotificationSettings,
  telegramAvailable: boolean,
): ICrmNotificationSettingsView {
  return {
    telegramAvailable,
    telegram: settings.telegram,
    time: settings.time,
    rules: NOTIFICATION_RULE_KEYS.map((key) => {
      const meta = NOTIFICATION_RULES[key];
      return {
        key,
        label: meta.label,
        description: meta.description,
        unit: meta.unit,
        enabled: settings.rules[key].enabled,
        threshold: settings.rules[key].threshold,
        min: meta.min,
        max: meta.max,
      };
    }),
  };
}

export type TSettingsParse =
  | { ok: true; patch: ISellerNotificationSettingsPatch }
  | { ok: false; field: string; message: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Тело PUT настроек. Каждое поле необязательно; неизвестное правило или поле —
 * отказ, а не молчаливый пропуск: форма с опечаткой должна узнать, что её не услышали.
 */
export function parseSettingsBody(body: unknown): TSettingsParse {
  if (!isObject(body)) return { ok: false, field: 'body', message: 'Ожидался объект настроек' };
  const patch: ISellerNotificationSettingsPatch = {};

  if (body.telegram !== undefined) {
    if (typeof body.telegram !== 'boolean') {
      return { ok: false, field: 'telegram', message: 'Ожидалось «да» или «нет»' };
    }
    patch.telegram = body.telegram;
  }
  if (body.time !== undefined) {
    const parsed = parseScheduleTime(typeof body.time === 'string' ? body.time : '');
    if (!parsed.ok) return { ok: false, field: 'time', message: parsed.error };
    patch.time = parsed.time.value;
  }
  if (body.rules !== undefined) {
    if (!isObject(body.rules))
      return { ok: false, field: 'rules', message: 'Ожидался объект правил' };
    const rules: Partial<Record<TNotificationRule, Partial<INotificationRuleSetting>>> = {};
    for (const [key, raw] of Object.entries(body.rules)) {
      if (!NOTIFICATION_RULE_KEYS.includes(key as TNotificationRule)) {
        return { ok: false, field: `rules.${key}`, message: 'Неизвестное правило' };
      }
      const rule = key as TNotificationRule;
      if (!isObject(raw)) return { ok: false, field: `rules.${key}`, message: 'Ожидался объект' };
      const row: Partial<INotificationRuleSetting> = {};
      if (raw.enabled !== undefined) {
        if (typeof raw.enabled !== 'boolean') {
          return { ok: false, field: `rules.${key}.enabled`, message: 'Ожидалось «да» или «нет»' };
        }
        row.enabled = raw.enabled;
      }
      if (raw.threshold !== undefined) {
        const error = thresholdError(rule, raw.threshold);
        if (error) return { ok: false, field: `rules.${key}.threshold`, message: error };
        if (NOTIFICATION_RULES[rule].unit !== null) row.threshold = raw.threshold as number;
      }
      rules[rule] = row;
    }
    patch.rules = rules;
  }
  return { ok: true, patch };
}

/** Тело POST /read: `{ all: true }` или `{ ids: [...] }`. null — тело не разобрано. */
export function parseReadBody(body: unknown): string[] | 'all' | null {
  if (!isObject(body)) return null;
  if (body.all === true) return 'all';
  if (Array.isArray(body.ids) && body.ids.every((id) => typeof id === 'string' && id.length > 0)) {
    return body.ids as string[];
  }
  return null;
}

/** `?skip=&limit=` — с потолком; мусор — умолчание. */
export function pageOf(skip: unknown, limit: unknown): { skip: number; limit: number } {
  const s = Number(skip);
  const l = Number(limit);
  return {
    skip: Number.isInteger(s) && s > 0 ? s : 0,
    limit: Number.isInteger(l) && l > 0 ? Math.min(l, PAGE_LIMIT_MAX) : 50,
  };
}
