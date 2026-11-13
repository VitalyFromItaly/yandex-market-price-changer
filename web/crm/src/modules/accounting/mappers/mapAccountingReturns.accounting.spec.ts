import { describe, expect, it } from 'vitest';

import { returnsResponse } from './accountingReturns.fixtures.accounting';
import {
  RETURNS_UNKNOWN_LABEL,
  formatShare,
  mapAccountingReturns,
} from './mapAccountingReturns.accounting';

const cellsOf = (key: string) =>
  mapAccountingReturns(returnsResponse()).metrics.find((m) => m.key === key)?.cells;

describe('mapAccountingReturns', () => {
  it('площадки колонками рядом, без общего итога', () => {
    const view = mapAccountingReturns(returnsResponse());
    expect(view.columns.map((c) => c.label)).toEqual(['Яндекс Маркет', 'Ozon']);
    expect(view.metrics.every((m) => m.cells.length === 2)).toBe(true);
    expect(view.periodLabel).toBe('Октябрь 2026');
    expect(view.hasReturns).toBe(true);
  });

  it('количество, доля, деньги со знаком', () => {
    expect(cellsOf('count')).toEqual(['2 из 20', '1 из 0']);
    expect(cellsOf('rate')).toEqual(['10 %', '—']);
    expect(cellsOf('reverse')?.[0]).toMatch(/120/);
  });

  it('неизвестное — словом, не «0 ₽»; итог называет число заказов', () => {
    expect(cellsOf('value')?.[1]).toBe(RETURNS_UNKNOWN_LABEL);
    expect(cellsOf('writeOff')?.[1]).toBe(RETURNS_UNKNOWN_LABEL);
    expect(cellsOf('result')?.[1]).toBe('Неизвестно у 1 заказа');
    const result = mapAccountingReturns(returnsResponse()).metrics.at(-1);
    expect(result?.total).toBe(true);
  });

  it('необязательные строки — только если где-то не ноль', () => {
    const data = returnsResponse();
    data.marketplaces = data.marketplaces.map((m) => ({
      ...m,
      writeOffKopecks: 0,
      repackingKopecks: 0,
    }));
    const keys = mapAccountingReturns(data).metrics.map((m) => m.key);
    expect(keys).not.toContain('writeOff');
    expect(keys).not.toContain('repacking');
  });

  it('модели и заказы: подписи, неизвестный итог, без названия', () => {
    const view = mapAccountingReturns(returnsResponse());
    expect(view.models[0]).toMatchObject({
      name: 'Чайник',
      returnedLabel: '2 из 8 шт.',
      rateLabel: '25 %',
    });
    expect(view.orders[0]).toMatchObject({ dayLabel: '20-10-2026', isLoss: true });
    expect(view.orders[1]).toMatchObject({
      title: 'Без названия',
      resultLabel: RETURNS_UNKNOWN_LABEL,
      marketplaceLabel: 'Ozon',
      isLoss: false,
    });
  });

  it('formatShare — десятые доли процента', () => {
    expect(formatShare(0.1234)).toBe('12,3 %');
    expect(formatShare(null)).toBe('—');
  });
});
