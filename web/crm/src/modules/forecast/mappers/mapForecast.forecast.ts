import type {
  Forecast,
  ForecastCard,
  ForecastMetrics,
  MarginBar,
  PurchaseRow,
  PurchaseView,
  Tone,
  WhatIfView,
} from '../forecast.domain';

import { formatCount, formatKopecks, plural } from '@/shared/utils';

const PERCENT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const SPEED = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** Доля (0,234) → «23,4 %»; null — «—». */
export function formatShare(value: number | null): string {
  return value === null ? '—' : `${PERCENT.format(value * 100)} %`;
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const days = (n: number) => `${n} ${plural(n, ['день', 'дня', 'дней'])}`;
const toneOf = (kopecks: number): Tone => (kopecks < 0 ? 'danger' : 'ok');

type MoneyKey = Exclude<keyof ForecastMetrics, 'units' | 'orders'>;

/** Подпись под прогнозом: факт и сколько добавят оставшиеся дни. */
function caption(
  fact: number,
  forecast: number,
  factTo: string | null,
  remaining: number,
  money: boolean,
): string {
  const format = money ? formatKopecks : formatCount;
  const factPart = factTo ? `факт ${format(fact)} по ${ddmm(factTo)}` : 'факта ещё нет';
  return `${factPart} · ещё ${format(forecast - fact)} за ${days(remaining)}`;
}

function moneyCard(f: Forecast, key: MoneyKey, title: string, signed = false): ForecastCard {
  const value = f.month.forecast[key];
  return {
    key,
    title,
    value: formatKopecks(value),
    caption: caption(f.month.fact[key], value, f.month.factTo, f.month.remainingDays, true),
    tone: signed ? toneOf(value) : 'muted',
  };
}

/** Карточки «до конца месяца» — каждое число прогноза с фактом под ним. */
export function monthCards(f: Forecast): ForecastCard[] {
  const units = f.month.forecast.units;
  return [
    moneyCard(f, 'revenueKopecks', 'Выручка'),
    moneyCard(f, 'netKopecks', 'Чистая прибыль', true),
    {
      key: 'units',
      title: 'Продано, шт.',
      value: formatCount(units),
      caption: caption(f.month.fact.units, units, f.month.factTo, f.month.remainingDays, false),
      tone: 'muted',
    },
    moneyCard(f, 'returnsKopecks', 'Возвраты'),
    moneyCard(f, 'taxKopecks', 'Налог'),
  ];
}

/** «До конца года» — выручка, штуки и налог. */
export function yearCards(f: Forecast): ForecastCard[] {
  const { fact, forecast, remainingDays } = f.year;
  const factTo = f.month.factTo ?? null;
  return [
    {
      key: 'revenue',
      title: `Выручка за ${f.year.year}`,
      value: formatKopecks(forecast.revenueKopecks),
      caption: caption(fact.revenueKopecks, forecast.revenueKopecks, factTo, remainingDays, true),
      tone: 'muted',
    },
    {
      key: 'units',
      title: 'Продано за год, шт.',
      value: formatCount(forecast.units),
      caption: caption(fact.units, forecast.units, factTo, remainingDays, false),
      tone: 'muted',
    },
    {
      key: 'tax',
      title: 'Налог за год',
      value: formatKopecks(forecast.taxKopecks),
      caption: caption(fact.taxKopecks, forecast.taxKopecks, factTo, remainingDays, true),
      tone: 'muted',
    },
  ];
}

/**
 * What-if «комиссия ±N п.п.» (решение `forecast_whatif_block`): поправка
 * ложится на выручку ОСТАВШИХСЯ дней — прошедшие уже начислены. При «доходы
 * минус расходы» лишняя комиссия — расход и уменьшает налог по ставке режима
 * (минимальный налог не учитывается); при «Доходах» налог от неё не зависит.
 */
export function whatIfOf(f: Forecast, deltaPp: number): WhatIfView {
  const remainingRevenue = f.month.forecast.revenueKopecks - f.month.fact.revenueKopecks;
  const commissionKopecks = Math.round((remainingRevenue * deltaPp) / 100);
  const profitBased = f.tax.regime === 'usn_income_minus_expenses';
  const taxKopecks = profitBased
    ? -Math.round((commissionKopecks * f.tax.rateBasisPoints) / 10_000)
    : 0;
  const netKopecks = -commissionKopecks - taxKopecks;
  const before = f.month.forecast.netKopecks;
  return {
    deltaPp,
    commissionKopecks,
    taxKopecks,
    netKopecks,
    netBefore: formatKopecks(before),
    netAfter: formatKopecks(before + netKopecks),
    note: profitBased
      ? 'Налог «доходы минус расходы»: комиссия — расход, налог уменьшается по ставке.'
      : 'Налог «Доходы»: от комиссии он не зависит.',
  };
}

const monthLabel = (month: string) => `${month.slice(5, 7)}.${month.slice(0, 4)}`;

/** Рентабельность по чистой — одна полоса на месяц, последний — прогноз. */
export function marginBars(f: Forecast): MarginBar[] {
  const max = Math.max(0.0001, ...f.margins.map((m) => Math.abs(m.netMargin ?? 0)));
  return f.margins.map((m) => ({
    month: m.month,
    label: monthLabel(m.month),
    value: m.netMargin === null ? 'нет данных' : formatShare(m.netMargin),
    width: m.netMargin === null ? 0 : Math.abs(m.netMargin) / max,
    tone: m.netMargin === null ? 'muted' : toneOf(m.netMargin),
    forecast: m.kind === 'forecast',
  }));
}

/** Строки закупок; «срочно» — остатка меньше чем на неделю. */
export function purchaseView(row: PurchaseRow): PurchaseView {
  return {
    sku: row.sku,
    name: row.name ?? row.sku,
    speed: `${SPEED.format(row.unitsPerDay)} шт./день`,
    stock: row.stock === null ? '—' : formatCount(row.stock),
    daysLeft: row.daysLeft === null ? '—' : days(row.daysLeft),
    need: row.needUnits ? formatCount(row.needUnits) : '—',
    needSum: row.needKopecks === null ? 'нет закупа' : formatKopecks(row.needKopecks),
    urgent: row.daysLeft !== null && row.daysLeft < 7,
  };
}
