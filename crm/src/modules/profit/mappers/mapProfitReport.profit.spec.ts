import type { ProfitBlockResponse, ProfitResponse, TariffResponse } from '../profit.domain';

import { describe, expect, it } from 'vitest';

import { formatPercent, mapProfit, mapTariff } from './mapProfitReport.profit';

import { formatRub } from '@/shared/utils';

const BLOCK: ProfitBlockResponse = {
  orders: 3,
  revenue: 10_000,
  subsidies: 1000,
  commission: 2300,
  commissionPercent: 23,
  tax: 700,
  taxPercent: 7,
  promo: 0,
  purchase: 5000,
  net: 2000,
};

const BASE = {
  period: { key: 'month' as const, day: null },
  title: 'Прибыль',
  periodTitle: 'с начала месяца (01-08-2026 — 03-08-2026)',
  emptyText: 'За этот период заказов нет.',
  empty: false,
  returned: { orders: 0, revenue: 0 },
  excluded: { orders: 0, revenue: 0, skus: [], reason: 'нет закупочной цены' },
  prices: {
    updatedAt: '01-08-2026',
    defaultPercent: 10,
    overrides: [],
    text: 'Закуп: прайс от 01-08-2026 минус 10% (Восток 4%).',
  },
};

function profit(overrides: Partial<ProfitResponse> = {}): ProfitResponse {
  return {
    ...BASE,
    key: 'profit',
    main: 'placed',
    placed: BLOCK,
    redeemed: { ...BLOCK, orders: 2, revenue: 4000, net: -150 },
    cancelled: 0,
    estimate: null,
    promo: [],
    notes: {
      placed: 'Заказы ещё едут — часть могут не выкупить.',
      otherOrders: 'Это другие заказы: оформленные за период попадут сюда после выкупа.',
      unknownSkus: 'Пришлите прайс с этими позициями — они попадут в расчёт.',
    },
    ...overrides,
  };
}

describe('маппер «Прибыли»', () => {
  it('процент без лишнего «.0», как у бота', () => {
    expect(formatPercent(23)).toBe('23');
    expect(formatPercent(23.456)).toBe('23.46');
  });

  it('основной блок — оформленные: столбец бота, выкупленное одной строкой', () => {
    const screen = mapProfit(profit());
    expect(screen.breakdown.countLabel).toBe('Оформлено');
    expect(screen.breakdown.rows.map((row) => row.label)).toEqual([
      'Продажи',
      'Комиссия 23%',
      'Налог 7%',
      'Закуп',
      'Ожидается чистая',
    ]);
    expect(screen.breakdown.rows[0]?.hint).toBe(`в т.ч. субсидии Маркета: ${formatRub(1000)}`);
    expect(screen.lines[0]).toContain('Выкуплено: 2');
    expect(screen.lines[1]).toContain('Это другие заказы');
    expect(screen.excluded).toBeNull();
    expect(screen.breakdown.margin).toBe(0.2);
  });

  it('маржа без продаж — null, а не деление на ноль', () => {
    const screen = mapProfit(
      profit({ main: 'redeemed', redeemed: { ...BLOCK, revenue: 0, net: 0 } }),
    );
    expect(screen.breakdown.margin).toBeNull();
  });

  it('без оформленных основным становится выкупленное; убыток помечен', () => {
    const screen = mapProfit(profit({ main: 'redeemed' }));
    const total = screen.breakdown.rows.at(-1);
    expect(screen.breakdown.countLabel).toBe('Заказов');
    expect(total).toMatchObject({ label: 'Чистая', value: -150, negative: true });
    expect(screen.breakdown.note).toBeNull();
    expect(screen.breakdown.margin).toBeCloseTo(-0.0375);
    expect(screen.lines.some((line) => line.startsWith('Выкуплено'))).toBe(false);
  });

  it('строка калькулятора — справочная, под комиссией; продвижение — только начисленное', () => {
    const screen = mapProfit(
      profit({
        estimate: { servicesTotal: 2400, share: '≈24%' },
        placed: { ...BLOCK, promo: 300 },
        promo: ['CASIO 5%'],
      }),
    );
    const labels = screen.breakdown.rows.map((row) => row.label);
    expect(labels.slice(1, 3)).toEqual(['Комиссия 23%', 'По калькулятору Маркета']);
    expect(screen.breakdown.rows[2]).toMatchObject({ kind: 'info', hint: '≈24%' });
    expect(labels).toContain('Продвижение');
    expect(screen.footer).toEqual([BASE.prices.text, 'Продвижение: CASIO 5%.']);
  });

  it('отменённые, возвраты и исключённые — со всеми sku и советом', () => {
    const screen = mapProfit(
      profit({
        cancelled: 2,
        returned: { orders: 1, revenue: 500 },
        excluded: { orders: 4, revenue: 9000, skus: ['A', 'B'], reason: 'нет закупочной цены' },
      }),
    );
    expect(screen.lines[0]).toBe('Отменено: 2 — в расчёт не входят.');
    expect(screen.lines.at(-1)).toContain('Возвраты: 1');
    expect(screen.excluded).toMatchObject({ orders: 4, skus: ['A', 'B'] });
    expect(screen.excluded?.advice).toContain('Пришлите прайс');
  });
});

function tariff(overrides: Partial<TariffResponse> = {}): TariffResponse {
  return {
    ...BASE,
    key: 'tariff_calc',
    totalOrders: 3,
    block: { ...BLOCK, commission: 2400 },
    servicesShare: '≈24%',
    services: [
      { type: 'FEE', label: 'Размещение', sum: 1500 },
      { type: 'DELIVERY_TO_CUSTOMER', label: 'Доставка покупателю', sum: 900 },
    ],
    comparison: {
      commissionPercent: 16,
      flat: 1600,
      diff: 800,
      servicesHigher: true,
      text: 'По вашей ставке 16% было бы 1 600 ₽ — на 800 ₽ меньше услуг…',
    },
    notes: {
      placed: 'Заказы ещё едут — часть могут не выкупить.',
      approx: 'Услуги посчитаны примерно — по тарифам Маркета, без индивидуальных условий.',
      nothingCounted: 'Посчитать не удалось ни одного заказа.',
    },
    ...overrides,
  };
}

describe('маппер «Калькулятора»', () => {
  it('услуги вместо комиссии, сравнение со ставкой — первой строкой', () => {
    const screen = mapTariff(tariff());
    expect(screen.breakdown?.rows[1]).toMatchObject({
      label: 'Услуги Маркета',
      value: 2400,
      hint: '≈24%',
    });
    expect(screen.services).toHaveLength(2);
    expect(screen.lines[0]).toContain('По вашей ставке 16%');
    expect(screen.footer.at(-1)).toContain('примерно');
  });

  it('заказы есть, посчитать нечего — нет столбца, причина в строке; совета про прайс нет', () => {
    const screen = mapTariff(
      tariff({
        block: { ...BLOCK, orders: 0 },
        excluded: { orders: 3, revenue: 10_000, skus: ['X'], reason: 'нет категории' },
      }),
    );
    expect(screen.breakdown).toBeNull();
    expect(screen.services).toEqual([]);
    expect(screen.lines[0]).toBe('Оформлено: 3. Посчитать не удалось ни одного заказа.');
    expect(screen.excluded?.advice).toBeNull();
  });
});
