import type { FinanceMonth, PnlResponse } from '../finance.domain';

import { describe, expect, it } from 'vitest';

import { monthLabel, toMonthOption, toMonthStatus, toPnlModel } from './mapPnl.finance';

import { formatRub as rub } from '@/shared/utils';

function pnl(overrides: Partial<PnlResponse> = {}): PnlResponse {
  return {
    month: '2026-09',
    from: '2026-09-01',
    to: '2026-09-30',
    status: 'verified',
    statusLabel: 'Проверено',
    unconfirmed: { confirmed: true, orders: 0, revenueKopecks: 0, skus: [] },
    taxIsDefault: false,
    levels: {
      revenueKopecks: 1_000_000,
      otherIncomeKopecks: 0,
      cogsKopecks: 400_000,
      grossKopecks: 600_000,
      marketplaceKopecks: -200_000,
      unrecognizedKopecks: 0,
      afterMarketplaceKopecks: 400_000,
      operatingExpensesKopecks: 100_000,
      operatingKopecks: 300_000,
      taxKopecks: 60_000,
      netKopecks: 240_000,
      grossMargin: 0.6,
      netMargin: 0.24,
    },
    sections: [
      {
        key: 'marketplace',
        title: 'Расходы площадки',
        kopecks: -200_000,
        articles: [
          {
            article: 'delivery_to_buyer',
            title: 'Логистика до покупателя',
            kopecks: -200_000,
            operationIds: ['a', 'b'],
          },
        ],
      },
      { key: 'reference', title: 'Справочно — не деньги', kopecks: -5, articles: [] },
    ],
    tax: { incomeKopecks: 1_000_000, minimumApplied: false, undatedLines: 0 },
    flat: null,
    flatNote: null,
    ...overrides,
  };
}

describe('toPnlModel', () => {
  it('уровни со знаком у расходов, чистая и маржа; проверенный месяц без пометок', () => {
    const model = toPnlModel(pnl());
    expect(model.rangeLabel).toBe('01-09-2026 — 30-09-2026');
    expect(model.preliminary).toBe(false);
    expect(model.tone).toBe('ok');
    const byKey = Object.fromEntries(model.levels.map((row) => [row.key, row.amount]));
    expect(byKey.cogs).toBe(rub(-4000));
    expect(byKey.marketplace).toBe(rub(-2000));
    expect(byKey.tax).toBe(rub(-600));
    // Нераспознанного нет — строки нет.
    expect(byKey.unrecognized).toBeUndefined();
    expect(model.net).toBe(rub(2400));
    expect(model.netMargin).toBe('24,0 %');
    expect(model.notes).toEqual([]);
    expect(model.flat).toBeNull();
  });

  it('статья несёт свои id и подпись числа операций; справочный раздел помечен', () => {
    const model = toPnlModel(pnl());
    expect(model.sections[0]?.articles[0]).toMatchObject({
      title: 'Логистика до покупателя',
      amount: rub(-2000),
      countLabel: '2 операции',
      operationIds: ['a', 'b'],
    });
    expect(model.sections[1]?.reference).toBe(true);
  });

  it('непроверенный месяц: предварительно, плоская оценка подписана, пояснения словами', () => {
    const model = toPnlModel(
      pnl({
        status: 'preliminary',
        statusLabel: 'Предварительные данные',
        unconfirmed: {
          confirmed: false,
          orders: 2,
          revenueKopecks: 350_000,
          skus: ['A', 'B', 'C'],
        },
        taxIsDefault: true,
        flat: {
          label: 'Предварительные данные',
          block: 'placed',
          revenue: 10_000,
          commission: 2300,
          tax: 700,
          promo: 0,
          purchase: 4000,
          net: 3000,
          orders: 4,
        },
      }),
    );
    expect(model.preliminary).toBe(true);
    expect(model.tone).toBe('warn');
    expect(model.flat?.net).toBe(rub(3000));
    expect(model.flat?.rows.find((row) => row.key === 'commission')?.amount).toBe(rub(-2300));
    expect(model.notes[0]).toMatch(/^Прибыль не подтверждена: 2 заказа на 3[\s\u00a0]500\s₽/);
    expect(model.notes[0]).toContain('3 артикула');
    expect(model.notes[1]).toContain('УСН «Доходы» 6 %');
  });

  it('плоской оценки нет — её причина среди пояснений', () => {
    const model = toPnlModel(
      pnl({
        status: 'preliminary',
        statusLabel: 'Предварительные данные',
        flatNote: 'Только текущий',
      }),
    );
    expect(model.notes).toContain('Только текущий');
  });
});

describe('месяцы', () => {
  const month = (overrides: Partial<FinanceMonth> = {}): FinanceMonth => ({
    month: '2026-09',
    from: '2026-09-01',
    to: '2026-09-30',
    status: 'discrepancy',
    statusLabel: 'Есть расхождения',
    discrepancyCount: 2,
    changedCount: 1,
    removedCount: 1,
    unknownCount: 0,
    reconcileNote: null,
    checkedAt: '2026-10-02T01:00:00.000Z',
    ...overrides,
  });

  it('подпись месяца и тон статуса', () => {
    expect(monthLabel('2026-09')).toBe('Сентябрь 2026');
    expect(toMonthOption(month())).toEqual({
      value: '2026-09',
      label: 'Сентябрь 2026',
      statusLabel: 'Есть расхождения',
      tone: 'danger',
    });
    expect(toMonthOption(month({ status: null, statusLabel: 'Журнал не загружен' })).tone).toBe(
      'default',
    );
  });

  it('статус месяца: загрузка, правки Маркета; незагруженный — одной строкой', () => {
    expect(toMonthStatus(month()).lines).toEqual([
      'Последняя загрузка: 02-10-2026.',
      'Маркет поправил 2 строки отчёта после первой загрузки.',
    ]);
    expect(toMonthStatus(month({ status: null })).lines).toEqual([
      'Журнал за месяц ещё не загружался — загрузка идёт ночью.',
    ]);
  });
});
