import type { Forecast, ForecastMetrics } from '../forecast.domain';

import { describe, expect, it } from 'vitest';

import { marginBars, monthCards, purchaseView, whatIfOf } from './mapForecast.forecast';

const metrics = (over: Partial<ForecastMetrics> = {}): ForecastMetrics => ({
  revenueKopecks: 0,
  netKopecks: 0,
  units: 0,
  orders: 0,
  returnsKopecks: 0,
  taxKopecks: 0,
  payableKopecks: 0,
  ...over,
});

function forecast(over: Partial<Forecast> = {}): Forecast {
  return {
    kind: 'forecast',
    today: '2026-10-17',
    method: { basisDays: 28, basis: { from: '2026-09-19', to: '2026-10-16' }, text: 'Линейно' },
    daily: metrics({ revenueKopecks: 100_000 }),
    month: {
      period: { from: '2026-10-01', to: '2026-10-31' },
      factTo: '2026-10-16',
      remainingDays: 15,
      fact: metrics({ revenueKopecks: 1_600_000, netKopecks: 500_000, units: 16 }),
      forecast: metrics({ revenueKopecks: 3_100_000, netKopecks: 1_000_000, units: 31 }),
      netMargin: 0.32,
    },
    year: { year: 2026, remainingDays: 76, fact: metrics(), forecast: metrics() },
    taxShare: 0.06,
    returnsShare: null,
    inflow: { asOf: '2026-10-17', receivableKopecks: 0, accrualsKopecks: 0, totalKopecks: 0 },
    margins: [
      { month: '2026-08', kind: 'fact', netMargin: null, revenueKopecks: null, netKopecks: null },
      { month: '2026-09', kind: 'fact', netMargin: -0.1, revenueKopecks: 1, netKopecks: -1 },
      { month: '2026-10', kind: 'forecast', netMargin: 0.2, revenueKopecks: 1, netKopecks: 1 },
    ],
    unconfirmed: { confirmed: true, orders: 0, revenueKopecks: 0, skus: [] },
    taxIsDefault: false,
    tax: { regime: 'usn_income', rateBasisPoints: 600 },
    ...over,
  } as Forecast;
}

describe('маппер «Прогнозов»', () => {
  it('карточка месяца: прогноз крупно, под ним факт по вчера и добавка оставшихся дней', () => {
    const [revenue, net, units] = monthCards(forecast());
    if (!revenue || !net || !units) throw new Error('нет карточек');
    expect(revenue.value).toMatch(/31\s000/);
    expect(revenue.caption).toMatch(/^факт 16\s000.*по 16\.10 · ещё 15\s000.* за 15 дней$/);
    expect(net.tone).toBe('ok');
    expect(units.caption).toBe('факт 16 по 16.10 · ещё 15 за 15 дней');
  });

  it('1-го числа факта нет — подпись так и говорит', () => {
    const f = forecast();
    f.month.factTo = null;
    expect(monthCards(f)[0]?.caption).toMatch(/^факта ещё нет/);
  });

  it('what-if: комиссия — на выручку оставшихся дней; при «Доходах» налог не меняется', () => {
    const view = whatIfOf(forecast(), 5);
    expect(view.commissionKopecks).toBe(75_000);
    expect(view.taxKopecks).toBe(0);
    expect(view.netKopecks).toBe(-75_000);
  });

  it('what-if: при «доходы минус расходы» налог уменьшается по ставке', () => {
    const view = whatIfOf(
      forecast({ tax: { regime: 'usn_income_minus_expenses', rateBasisPoints: 1500 } }),
      5,
    );
    expect(view.taxKopecks).toBe(-11_250);
    expect(view.netKopecks).toBe(-63_750);
  });

  it('рентабельность: нет данных — пустая полоса, последний месяц помечен прогнозом', () => {
    const bars = marginBars(forecast());
    expect(bars.map((b) => [b.label, b.value, b.width, b.tone, b.forecast])).toEqual([
      ['08.2026', 'нет данных', 0, 'muted', false],
      ['09.2026', '-10 %', 0.5, 'danger', false],
      ['10.2026', '20 %', 1, 'ok', true],
    ]);
  });

  it('закупка: меньше недели — срочно, без закупа — словами', () => {
    const view = purchaseView({
      sku: 'A1',
      name: null,
      unitsPerDay: 1.5,
      stock: 3,
      daysLeft: 2,
      needUnits: 42,
      unitCostKopecks: null,
      needKopecks: null,
    });
    expect(view).toMatchObject({ name: 'A1', urgent: true, needSum: 'нет закупа', need: '42' });
    expect(view.daysLeft).toBe('2 дня');
  });
});
