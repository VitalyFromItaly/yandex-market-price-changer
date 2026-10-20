import type { IStockLine } from '../../src/modules/notifications/notifications.domain';

import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_RULES,
  NOTIFICATION_RULE_KEYS,
  anomalyEvents,
  defaultRuleSettings,
  diffNotifications,
  mergeRuleSettings,
  productLossEvents,
  returnsEvents,
  salesEvents,
  stockEvents,
  stockLinesOf,
  subjectMarketplace,
  taxEvents,
  thresholdError,
} from '../../src/modules/notifications/notifications.domain';
import {
  NOTIFICATION_TEXT,
  telegramDigest,
} from '../../src/modules/notifications/notifications.text';

const settings = defaultRuleSettings();

function line(patch: Partial<IStockLine> = {}): IStockLine {
  return {
    productId: 'p1',
    label: 'Casio A1 (A1)',
    available: 10,
    unitsPerDay: 1,
    costKopecks: 100_000,
    valueKopecks: 1_000_000,
    ...patch,
  };
}

describe('настройки правил', () => {
  it('без документа — все правила включены с порогами по умолчанию', () => {
    const rules = mergeRuleSettings(null);
    for (const key of NOTIFICATION_RULE_KEYS) {
      expect(rules[key]).toEqual({
        enabled: true,
        threshold: NOTIFICATION_RULES[key].defaultThreshold,
      });
    }
    expect(rules.low_stock.threshold).toBe(5);
  });

  it('сохранённое поверх умолчаний; порог правилу без порога не приписывается', () => {
    const rules = mergeRuleSettings({
      low_stock: { threshold: 3 },
      sales_drop: { enabled: false },
      tax_limit: { threshold: 50 },
    });
    expect(rules.low_stock).toEqual({ enabled: true, threshold: 3 });
    expect(rules.sales_drop.enabled).toBe(false);
    expect(rules.tax_limit.threshold).toBeNull();
  });

  it('порог проверяется по диапазону правила', () => {
    expect(thresholdError('low_stock', 0)).toMatch(/от 1/);
    expect(thresholdError('low_stock', 'пять')).toMatch(/числом/);
    expect(thresholdError('low_stock', 5)).toBeNull();
    expect(thresholdError('tax_limit', 5)).toMatch(/нет порога/);
  });
});

describe('diffNotifications — одно событие → одно уведомление до смены состояния', () => {
  const event = {
    rule: 'low_stock' as const,
    subjectKey: 'p1',
    fingerprint: 'low_stock',
    marketplace: null,
    title: 'Мало остатка',
    body: 'Доступно 3 шт.',
  };

  it('первый прогон создаёт, повтор с тем же состоянием — ничего', () => {
    const first = diffNotifications([], [event], () => false);
    expect(first.toCreate).toHaveLength(1);
    const second = diffNotifications([event], [{ ...event, body: 'Доступно 2 шт.' }], () => false);
    expect(second).toEqual({ toCreate: [], toResolve: [] });
  });

  it('смена состояния снимает прежнее и создаёт новое', () => {
    const out = { ...event, rule: 'out_of_stock' as const, fingerprint: 'out_of_stock' };
    const diff = diffNotifications([event], [out], () => false);
    expect(diff.toCreate).toEqual([out]);
    expect(diff.toResolve).toEqual([event]);

    const sameRule = { ...event, fingerprint: 'other' };
    const changed = diffNotifications([event], [sameRule], () => false);
    expect(changed.toCreate).toEqual([sameRule]);
    expect(changed.toResolve).toEqual([event]);
  });

  it('условие пропало — снять; появилось снова — снова уведомить', () => {
    const gone = diffNotifications([event], [], () => false);
    expect(gone.toResolve).toEqual([event]);
    expect(diffNotifications([], [event], () => false).toCreate).toHaveLength(1);
  });

  it('правило, которое не посчиталось, своих активных не снимает', () => {
    const diff = diffNotifications([event], [], (row) => row.rule === 'low_stock');
    expect(diff.toResolve).toEqual([]);
  });

  it('площадка предмета — только у правил «на площадку»', () => {
    expect(subjectMarketplace({ rule: 'sales_drop', subjectKey: 'ozon', fingerprint: 'x' })).toBe(
      'ozon',
    );
    expect(
      subjectMarketplace({ rule: 'product_loss', subjectKey: 'wb:A1', fingerprint: 'x' }),
    ).toBe('wb');
    expect(
      subjectMarketplace({ rule: 'low_stock', subjectKey: 'ym', fingerprint: 'x' }),
    ).toBeNull();
  });

  it('дубль события в одном прогоне — одно уведомление', () => {
    expect(diffNotifications([], [event, event], () => false).toCreate).toHaveLength(1);
  });
});

describe('продажи и расходы — неделя к неделе, по площадке', () => {
  // Расходы по умолчанию — 20 % выручки в обоих окнах: доля не меняется.
  const pair = (
    current: number,
    previous: number,
    mpCurrent = -current / 5,
    mpPrevious = -previous / 5,
  ) => ({
    marketplace: 'ozon' as const,
    current: { revenueKopecks: current, marketplaceKopecks: mpCurrent },
    previous: { revenueKopecks: previous, marketplaceKopecks: mpPrevious },
  });

  it('падение на порог и больше — событие площадки; меньше — тишина', () => {
    const drop = salesEvents([pair(7_000_000, 10_000_000)], settings);
    expect(drop.map((e) => [e.rule, e.subjectKey, e.marketplace])).toEqual([
      ['sales_drop', 'ozon', 'ozon'],
    ]);
    expect(drop[0].title).toContain('Ozon');
    expect(salesEvents([pair(7_100_000, 10_000_000)], settings)).toEqual([]);
  });

  it('маленькая база не даёт процентов', () => {
    expect(salesEvents([pair(0, 900_000, 0, 0)], settings)).toEqual([]);
  });

  it('доля расходов площадки выросла на порог п.п.', () => {
    // 20 % → 25 %: +5 п.п. — ровно порог.
    const events = salesEvents([pair(10_000_000, 10_000_000, -2_500_000, -2_000_000)], settings);
    expect(events.map((e) => e.rule)).toEqual(['expenses_growth']);
  });

  it('выключенное правило молчит', () => {
    const off = mergeRuleSettings({ sales_drop: { enabled: false } });
    expect(salesEvents([pair(1_000_000, 10_000_000)], off)).toEqual([]);
  });
});

describe('товар в убытке', () => {
  it('только с известной себестоимостью и продажами', () => {
    const events = productLossEvents(
      'ym',
      [
        { sku: 'A1', units: 3, netKopecks: -500, costKnown: true },
        { sku: 'B1', units: 3, netKopecks: -500, costKnown: false },
        { sku: 'C1', units: 3, netKopecks: 500, costKnown: true },
      ],
      new Map([['A1', 'Casio A1']]),
      settings,
    );
    expect(events.map((e) => e.subjectKey)).toEqual(['ym:A1']);
    expect(events[0].title).toContain('Casio A1');
  });
});

describe('аномалии журнала', () => {
  it('комиссия и удержания — свои правила; просмотренные и прочие виды — нет', () => {
    const row = (key: string, kind: string, reviewed = false) =>
      ({ key, kind, detail: 'подробно', amountKopecks: -1000, reviewed }) as never;
    const events = anomalyEvents(
      [
        row('k1', 'commission_spike'),
        row('k2', 'penalty'),
        row('k3', 'unknown_article'),
        row('k4', 'missing_cost'),
        row('k5', 'penalty', true),
      ],
      settings,
    );
    expect(events.map((e) => [e.rule, e.subjectKey])).toEqual([
      ['commission_change', 'k1'],
      ['suspicious_withholdings', 'k2'],
      ['suspicious_withholdings', 'k3'],
    ]);
  });
});

describe('возвраты', () => {
  const prev = { returnRate: 0.1, lossesKopecks: 100_000, soldUnits: 50 };

  it('доля выросла на порог и потери выросли — событие площадки', () => {
    const events = returnsEvents(
      'wb',
      { returnRate: 0.15, lossesKopecks: 150_000 },
      prev,
      settings,
    );
    expect(events.map((e) => [e.rule, e.subjectKey])).toEqual([['returns_growth', 'wb']]);
  });

  it('потери не выросли, мало продаж или доли нет — тишина', () => {
    expect(returnsEvents('wb', { returnRate: 0.2, lossesKopecks: 90_000 }, prev, settings)).toEqual(
      [],
    );
    expect(
      returnsEvents(
        'wb',
        { returnRate: 0.3, lossesKopecks: 1 },
        { ...prev, soldUnits: 5, lossesKopecks: 0 },
        settings,
      ),
    ).toEqual([]);
    expect(returnsEvents('wb', { returnRate: null, lossesKopecks: 1 }, prev, settings)).toEqual([]);
  });
});

describe('налоговый лимит', () => {
  it('уровень — в отпечатке, предмет — лимит', () => {
    const events = taxEvents(
      [
        { key: 'usn_approaching', level: 'approaching', text: 'Подходит к лимиту УСН' },
        { key: 'params_missing', level: 'info', text: 'нет параметров' },
      ],
      settings,
    );
    expect(events.map((e) => [e.subjectKey, e.fingerprint])).toEqual([['usn', 'approaching']]);
    const exceeded = taxEvents(
      [{ key: 'usn_exceeded', level: 'exceeded', text: 'Превышен' }],
      settings,
    );
    const diff = diffNotifications(events, exceeded, () => false);
    expect(diff.toCreate).toHaveLength(1);
    expect(diff.toResolve).toHaveLength(1);
  });
});

describe('остатки', () => {
  it('уровень товара — одно из трёх по строгости', () => {
    const events = stockEvents(
      [
        line({ productId: 'zero', available: 0 }),
        line({ productId: 'low', available: 4 }),
        line({ productId: 'soon', available: 10, unitsPerDay: 1 }),
        line({ productId: 'fine', available: 100, unitsPerDay: 1 }),
      ],
      28,
      mergeRuleSettings({
        purchase_needed: { enabled: false },
        stock_value_high: { enabled: false },
      }),
    );
    expect(events.map((e) => [e.rule, e.subjectKey])).toEqual([
      ['out_of_stock', 'zero'],
      ['low_stock', 'low'],
      ['stock_running_out', 'soon'],
    ]);
  });

  it('порог «< 5»: ровно 5 — не мало, 4 — мало', () => {
    const only = mergeRuleSettings({ stock_running_out: { enabled: false } });
    const at = (available: number) =>
      stockEvents([line({ available, unitsPerDay: 0.01 })], 28, only).filter(
        (e) => e.rule === 'low_stock',
      );
    expect(at(5)).toEqual([]);
    expect(at(4)).toHaveLength(1);
  });

  it('товар без продаж за окно в «мало/закончился» не попадает — он «не продаётся»', () => {
    const events = stockEvents(
      [line({ productId: 'dead', available: 3, unitsPerDay: 0, valueKopecks: 300_000 })],
      28,
      settings,
    );
    expect(events.map((e) => e.rule)).toEqual(['stale_stock']);
    expect(events[0].body).toContain('3 шт.');
  });

  it('нужна закупка — одной сводкой; много денег в остатках — по порогу', () => {
    const events = stockEvents(
      [line({ available: 10, unitsPerDay: 2, valueKopecks: 60_000_000 })],
      28,
      settings,
    );
    const purchase = events.find((e) => e.rule === 'purchase_needed');
    expect(purchase.subjectKey).toBe('all');
    expect(purchase.title).toContain('50 шт.');
    expect(events.find((e) => e.rule === 'stock_value_high')).toBeTruthy();
  });

  it('«доступно» — свой склад, без прайса — наибольший FBS, плюс склады площадок', () => {
    const snapshot = {
      inventory: {
        rows: [
          {
            productId: 'p1',
            internalSku: 'A1',
            name: null,
            ownStock: null,
            byMarketplace: {
              ym: { seller: { available: 3, reserved: null } },
              ozon: { seller: { available: 5, reserved: null } },
            },
            atMarketplaces: 2,
            unitsPerDay: 1,
            costKopecks: null,
          },
        ],
      },
    } as never;
    expect(stockLinesOf(snapshot)[0]).toMatchObject({
      available: 7,
      label: 'A1',
      valueKopecks: null,
    });
  });
});

describe('тексты — один модуль на CRM и Telegram', () => {
  it('сводка Telegram — те же заголовок и тело, экранированные', () => {
    const parts = NOTIFICATION_TEXT.stock({
      rule: 'low_stock',
      label: 'Часы <G-Shock> & Co',
      available: 3,
      unitsPerDay: 1,
      daysLeft: 3,
    });
    const digest = telegramDigest([parts]);
    expect(digest).toContain('Часы &lt;G-Shock&gt; &amp; Co');
    expect(digest).not.toContain('<G-Shock>');
    expect(parts.body).toContain('Доступно 3 шт.');
  });

  it('длинная сводка обрезается со ссылкой на CRM', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, body: 'b' }));
    expect(telegramDigest(many)).toContain('…и ещё 5 — в CRM');
  });
});
