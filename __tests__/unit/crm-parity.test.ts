import { describe, expect, it } from 'vitest';

import { CRM_MARKETPLACE_GATE, CRM_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import {
  BOT_SCREEN_SECTIONS,
  FEATURES_WITHOUT_SECTION,
} from '../../src/modules/crm/crm-parity.domain';
import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';
import { FEATURE_KEYS, FEATURE_META } from '../../src/modules/telegram/bots/shared/features.domain';
import { allNavNames } from '../../web/crm/src/navigation.sections';

/**
 * Паритет «бот ↔ CRM» (TASK-088): новая фича или кнопка бота без места в CRM
 * роняет CI, а не всплывает жалобой продавца.
 */

// Фича площадки (ozon, wb) — гейт её разделов `ozon-*`/`wb-*`, а не исключение.
const sectioned = new Set([
  ...Object.values(CRM_SECTIONS).flat(),
  ...Object.values(CRM_MARKETPLACE_GATE),
]);

const navNames = allNavNames;

describe('паритет фич бота и разделов CRM', () => {
  it('каждая фича — в разделе CRM или в исключениях с причиной', () => {
    const orphans = FEATURE_KEYS.filter(
      (key) => !sectioned.has(key) && !(key in FEATURES_WITHOUT_SECTION),
    );
    expect(orphans, 'фичи без раздела CRM и без исключения').toEqual([]);
  });

  it('исключение — существующая фича без раздела и с непустой причиной', () => {
    for (const [key, reason] of Object.entries(FEATURES_WITHOUT_SECTION)) {
      expect(FEATURE_KEYS, key).toContain(key);
      expect(sectioned.has(key as never), `${key}: раздел есть — исключение устарело`).toBe(false);
      expect(reason?.trim(), key).toBeTruthy();
    }
  });

  it('исключения перечислены явно', () => {
    // Спрятать фичу в исключения — решение, а не способ позеленить тест.
    expect(Object.keys(FEATURES_WITHOUT_SECTION).sort()).toEqual(
      [
        'ai',
        'ai_weekly_digest',
        'deep_history',
        'fby_supply',
        'feedback_ai_reply',
        'finance_anomalies',
        'finance_pull',
        'finance_upload',
        'hosting_reminder',
        'notifications_telegram',
        'profit_actual',
        'promotion',
        'stock_push_write_ym',
        'stock_push_write_ozon',
        'stock_push_write_wb',
        'stock_push_schedule',
        'price_set_write_ym',
        'price_set_write_ozon',
        'price_set_write_wb',
        'tax_year',
      ].sort(),
    );
  });
});

describe('паритет кнопок меню бота и разделов CRM', () => {
  const entries = Object.entries(BOT_SCREEN_SECTIONS);

  it('каждый раздел из таблицы есть в CRM_SECTIONS и в навигации фронта', () => {
    const nav = new Set(navNames());
    for (const [key, parity] of entries) {
      if (!('section' in parity)) continue;
      expect(Object.keys(CRM_SECTIONS), key).toContain(parity.section);
      expect(nav.has(parity.section), `${key} → ${parity.section} нет в navigation.ts`).toBe(true);
    }
  });

  it('только в боте — один админский экран, с причиной', () => {
    const botOnly = entries.filter(([, p]) => 'botOnly' in p);
    expect(botOnly.map(([key]) => key)).toEqual(['USERS']);
    for (const [, p] of botOnly) {
      expect('botOnly' in p && p.botOnly.trim()).toBeTruthy();
    }
  });

  it('кнопка фичи ведёт в раздел, открываемый этой же фичей', () => {
    // Ловит неверное сопоставление: «Калькулятор» в разделе без tariff_calc
    // показывался бы продавцу, у которого фича закрыта, и наоборот.
    const menuKeyByLabel = new Map(Object.entries(MENU).map(([key, label]) => [label, key]));
    for (const feature of FEATURE_KEYS) {
      const menuKey = menuKeyByLabel.get(FEATURE_META[feature].label as never);
      if (!menuKey) continue;
      const parity = BOT_SCREEN_SECTIONS[menuKey as keyof typeof MENU];
      expect('section' in parity, `${menuKey} — экран фичи ${feature}`).toBe(true);
      if ('section' in parity) {
        expect(CRM_SECTIONS[parity.section], `${menuKey} → ${parity.section}`).toContain(feature);
      }
    }
  });
});
