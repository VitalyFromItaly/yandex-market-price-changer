import { describe, expect, it } from 'vitest';

import { analyticsResponse } from './accountingDashboard.fixtures.accounting';
import { mapAccountingAnalytics } from './mapAccountingAnalytics.accounting';

describe('mapAccountingAnalytics', () => {
  it('площадка без данных — причиной, не колонкой с нулями', () => {
    const view = mapAccountingAnalytics(analyticsResponse());
    expect(view.columns.map((c) => c.marketplace)).toEqual(['ym']);
    expect(view.missing).toEqual([
      expect.objectContaining({
        marketplace: 'ozon',
        reason: expect.stringMatching(/не подключена/),
      }),
    ]);
    const profit = view.compare.find((r) => r.key === 'profit');
    expect(profit?.cells).toEqual(['Неизвестно у 2 заказов']);
    expect(view.compare.find((r) => r.key === 'commission')?.cells[0]).toMatch(/−?-?12 %$/);
    expect(view.compare.find((r) => r.key === 'logistics')?.cells[0]).toBe('—');
  });

  it('прибыль по дням — ряд на площадку, неизвестный день — разрыв (null), не ноль', () => {
    const view = mapAccountingAnalytics(analyticsResponse());
    expect(view.series).toEqual([{ key: 'ym', label: 'Яндекс Маркет', tone: 'c1' }]);
    expect(view.points.map((p) => p.values.ym)).toEqual([300, null]);
    expect(view.points[1]?.hint).toContain('прибыль неизвестна');
    expect(view.unknownDaysNote).toMatch(/^1 день/);
  });

  it('ТОПы подписывают, что не вошло: многомодельные заказы, неизвестные модели, возвраты', () => {
    const view = mapAccountingAnalytics(analyticsResponse());
    expect(view.productsNotes).toEqual([
      'Заказов из нескольких моделей, не разнесённых по товарам: 2',
      'Моделей с неизвестной прибылью, не вошедших в ТОП: 1',
    ]);
    expect(view.returnModelsNote).toBe(
      'Возвратов из нескольких моделей, не разнесённых по моделям: 1',
    );
    expect(view.lossOrdersNote).toBe('Показано 1 из 3');
    expect(view.mostProfitable[0]?.ordersLabel).toBe('2 заказа · 3 шт.');
  });
});
