import { describe, expect, it } from 'vitest';

import { dashboardResponse } from './accountingDashboard.fixtures.accounting';
import {
  DASHBOARD_UNKNOWN_LABEL,
  mapAccountingDashboard,
} from './mapAccountingDashboard.accounting';

const row = (view: ReturnType<typeof mapAccountingDashboard>, key: string) =>
  view.rows.find((r) => r.key === key);

describe('mapAccountingDashboard', () => {
  it('колонки — площадки и «Все площадки» сервера, строки — в порядке сервера и итоги', () => {
    const view = mapAccountingDashboard(dashboardResponse());
    expect(view.columns.map((c) => c.label)).toEqual(['Яндекс Маркет', 'Ozon', 'Все площадки']);
    expect(view.columns[0]?.note).toContain('«Все площадки»');
    expect(view.columns[2]?.note).toBeNull();
    expect(view.rows.slice(0, 2).map((r) => r.title)).toEqual(['Выручка', 'Возвраты']);
    expect(view.rows.slice(-5).map((r) => r.key)).toEqual([
      'gross',
      'net',
      'margin',
      'payable',
      'received',
    ]);
    expect(row(view, 'payable')?.title).toBe('К выплате на 11-11-2026');
  });

  it('без «Все площадки» от сервера колонку сам не собирает', () => {
    const data = dashboardResponse();
    data.totals.all = null;
    const view = mapAccountingDashboard(data);
    expect(view.columns.map((c) => c.block)).toEqual(['ym', 'ozon']);
    expect(view.columns[0]?.note).toBe('Без налога, закупа и общих расходов');
  });

  it('ожидаемое — оценка с пояснением, неизвестное — словом с причиной, не нулём', () => {
    const view = mapAccountingDashboard(dashboardResponse());
    const commission = row(view, 'commission')?.cells[0];
    expect(commission?.state).toBe('estimate');
    expect(commission?.note).toMatch(/^Из них ожидается/);
    expect(commission?.line).toBe('commission');

    const cogs = row(view, 'cogs')?.cells[1];
    expect(cogs).toMatchObject({ text: DASHBOARD_UNKNOWN_LABEL, state: 'unknown', line: 'cogs' });
    expect(cogs?.note).toBeTruthy();
    expect(row(view, 'net')?.cells[1]).toMatchObject({ text: DASHBOARD_UNKNOWN_LABEL, line: null });
    expect(view.hasEstimate).toBe(true);
    expect(view.hasUnknown).toBe(true);
  });

  it('строка без сумм — прочерк и не раскрывается; маржа — процент сервера', () => {
    const view = mapAccountingDashboard(dashboardResponse());
    expect(row(view, 'tax')?.cells[0]).toMatchObject({ text: '—', line: null });
    expect(row(view, 'margin')?.cells[0]?.text).toBe('55 %');
    expect(row(view, 'payable')?.cells[1]?.text).toBe('—');
  });

  it('свежесть журнала и опции фильтров — из ответа', () => {
    const view = mapAccountingDashboard(dashboardResponse());
    expect(view.freshnessLabel).toMatch(/^Журнал обновлён/);
    expect(view.freshness[1]?.text).toBe('ещё не загружался');
    expect(view.basisOptions.map((o) => o.value)).toEqual(['sale', 'accrual', 'cash']);
    expect(view.marketplaceOptions).toEqual([
      { value: 'ym', label: 'Яндекс Маркет' },
      { value: 'ozon', label: 'Ozon' },
    ]);
  });
});
