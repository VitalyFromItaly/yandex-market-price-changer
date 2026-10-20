/**
 * «Сравнение площадок» (TASK-137, ТЗ п.2) — показатели ЯМ, Ozon и WB за один
 * период рядом и детерминированные выводы. Чистые функции над готовыми `IPnl`:
 * P&L каждой площадки строит тот же `pnlOf`, что «Финансы», здесь только
 * производные, доля расходов и сравнение. Выводы — сравнения чисел, не ИИ.
 *
 * Одинаковые правила учёта — два решения владельца:
 * - `compare_opex_by_revenue_share`: операционные расходы кабинета делятся по
 *   доле выручки (`shareAllocation`), иначе каждая площадка несла бы их целиком;
 * - `compare_tax_by_accrual`: налог по начислению у всех — у Ozon/WB нет выплат,
 *   и кассовый метод дал бы им налог 0.
 */

import type { IExpenseAllocation } from './expense-allocation';
import type { IPnl } from './pnl';
import type { TOverviewServiceGroup } from './service-groups';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';

import { MARKETPLACE_LABEL } from '../../shared/marketplace';

import { rubText } from './finance-anomalies';
import { splitKopecks } from './pnl-sku';
import { serviceGroupsOf } from './service-groups';

export const COMPARE_TAX_NOTE =
  'Налог всех площадок здесь считается по дате реализации: у Ozon и Wildberries в журнале нет выплат. ' +
  'Если в налоговых настройках стоит «по поступлению», налог и чистая отличаются от «Финансов».';

export const COMPARE_OPEX_NOTE =
  'Операционные расходы бизнеса разделены между площадками по доле выручки за период.';

export const COMPARE_OPEX_UNSHARED_NOTE =
  'Выручки за период нет ни на одной площадке — операционные расходы не разделены и в чистую площадок не вошли.';

export const COMPARE_UNVERIFIED_NOTE =
  'Сравнение предварительное: период проверен не у всех площадок (Ozon и Wildberries с кабинетами пока не сверяются вовсе).';

const EMPTY_ALLOCATION: IExpenseAllocation = { totalKopecks: 0, byCategory: {}, byExpense: [] };

/**
 * Доли расходов по весам (выручка площадок). Делится только итог — его одного
 * читает `pnlOf`; разбивка по категориям и записям остаётся у кабинета целиком,
 * поделённая по копейке она перестала бы сходиться с итогом доли.
 * null — весов > 0 нет: делить не по чему (`COMPARE_OPEX_UNSHARED_NOTE`).
 */
export function shareAllocation(
  allocation: IExpenseAllocation,
  weights: readonly number[],
): IExpenseAllocation[] | null {
  const positive = weights.map((weight) => (weight > 0 ? weight : 0));
  if (!positive.some((weight) => weight > 0)) return null;
  if (allocation.totalKopecks === 0) return positive.map(() => EMPTY_ALLOCATION);
  return splitKopecks(allocation.totalKopecks, positive).map((totalKopecks) => ({
    totalKopecks,
    byCategory: {},
    byExpense: [],
  }));
}

/** Пустая аллокация — для первого прохода `pnlOf`, где нужна только выручка. */
export function emptyAllocation(): IExpenseAllocation {
  return EMPTY_ALLOCATION;
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** Показатели таблицы ТЗ п.2 для одной площадки. Деньги — копейки со знаком журнала. */
export interface ICompareMetrics {
  /** Продажи + субсидии + возвраты — та же выручка, что в «Финансах». */
  revenueKopecks: number;
  /** Продажи + субсидии, до возвратов. */
  salesKopecks: number;
  /** Возвраты со знаком площадки (обычно < 0). */
  returnsKopecks: number;
  /** |возвраты| / продажи; null — продаж нет. */
  returnsShare: number | null;
  /** Различных заказов со строкой продажи. */
  orders: number;
  /** Выкуплено штук: продано минус вернулось. */
  units: number;
  avgCheckKopecks: number | null;
  services: Record<TOverviewServiceGroup, number>;
  /** |комиссия| / выручка. */
  commissionShare: number | null;
  /** Σ услуг и удержаний площадки (обычно < 0). */
  marketplaceKopecks: number;
  /** |услуги площадки| / выручка — «расходы к выручке». */
  costShare: number | null;
  cogsKopecks: number;
  /** Доля операционных расходов кабинета. */
  operatingExpensesKopecks: number;
  taxKopecks: number;
  netKopecks: number;
  netMargin: number | null;
  netPerOrderKopecks: number | null;
  /** false — у части проданного нет закупа: чистая завышена. */
  costComplete: boolean;
}

export function compareMetricsOf(pnl: IPnl): ICompareMetrics {
  const salesKopecks = pnl.byArticle.sales.kopecks + pnl.byArticle.subsidies.kopecks;
  const returnsKopecks = pnl.byArticle.returns.kopecks;
  const services = serviceGroupsOf(pnl);
  const revenue = pnl.revenueKopecks;
  return {
    revenueKopecks: revenue,
    salesKopecks,
    returnsKopecks,
    returnsShare: ratio(Math.abs(returnsKopecks), salesKopecks),
    orders: pnl.ordersCount,
    units: pnl.units,
    avgCheckKopecks: pnl.ordersCount > 0 ? Math.round(revenue / pnl.ordersCount) : null,
    services,
    commissionShare: ratio(Math.abs(services.commission), revenue),
    marketplaceKopecks: pnl.marketplaceKopecks,
    costShare: ratio(-pnl.marketplaceKopecks, revenue),
    cogsKopecks: pnl.cogs.kopecks,
    operatingExpensesKopecks: pnl.operatingExpenses.totalKopecks,
    taxKopecks: pnl.tax.taxKopecks,
    netKopecks: pnl.netKopecks,
    netMargin: pnl.netMargin,
    netPerOrderKopecks: pnl.ordersCount > 0 ? Math.round(pnl.netKopecks / pnl.ordersCount) : null,
    costComplete: pnl.unconfirmed.confirmed,
  };
}

/** Итог схемы (FBS/FBY/FBO…) одной площадки — Σ разреза `pnl.skus` по схеме. */
export interface ISchemeTotal {
  marketplace: TFinanceMarketplace;
  scheme: string;
  revenueKopecks: number;
  netKopecks: number;
  margin: number | null;
}

/**
 * Схемы площадки. Строки «не относится к товару» (подписка, хранение, опер.
 * расходы) схемы не имеют и не делятся — поэтому Σ схем меньше чистой площадки,
 * и сравниваются маржи, а не суммы. Схема null — площадка её не указала (WB).
 */
export function schemeTotalsOf(marketplace: TFinanceMarketplace, pnl: IPnl): ISchemeTotal[] {
  const totals = new Map<string, { revenue: number; net: number }>();
  for (const sku of pnl.skus.skus) {
    for (const part of sku.schemes) {
      if (!part.scheme) continue;
      const total = totals.get(part.scheme) ?? { revenue: 0, net: 0 };
      total.revenue += part.columns.revenue;
      total.net += part.netKopecks;
      totals.set(part.scheme, total);
    }
  }
  return [...totals.entries()]
    .map(([scheme, { revenue, net }]) => ({
      marketplace,
      scheme,
      revenueKopecks: revenue,
      netKopecks: net,
      margin: ratio(net, revenue),
    }))
    .sort((a, b) => a.scheme.localeCompare(b.scheme));
}

export type TCompareConclusionKind =
  | 'revenue'
  | 'net_per_order'
  | 'cost_share'
  | 'returns'
  | 'growth'
  | 'scheme'
  | 'product';

export const COMPARE_CONCLUSION_TITLE: Readonly<Record<TCompareConclusionKind, string>> = {
  revenue: 'Больше денег',
  net_per_order: 'Выше чистая на заказ',
  cost_share: 'Ниже расходы к выручке',
  returns: 'Больше возвратов',
  growth: 'Лучший рост',
  scheme: 'Выгоднее схема',
  product: 'Где выгоднее товар',
};

export const COMPARE_CONCLUSION_ORDER: readonly TCompareConclusionKind[] = [
  'revenue',
  'net_per_order',
  'cost_share',
  'returns',
  'growth',
  'scheme',
  'product',
];

/** Товар, который на одной площадке выгоднее, чем на другой. */
export interface ICompareProductWin {
  sku: string;
  winner: TFinanceMarketplace;
  runnerUp: TFinanceMarketplace;
  /** Чистая на штуку, копейки. */
  winnerPerUnitKopecks: number;
  runnerUpPerUnitKopecks: number;
}

export interface ICompareConclusion {
  kind: TCompareConclusionKind;
  title: string;
  /** null — сравнить не с чем или поровну, причина в `reason`. */
  winner: TFinanceMarketplace | null;
  text: string | null;
  reason: string | null;
  /** Схема-победитель (`scheme`). */
  scheme?: string;
  /** Товаров, где площадка выгоднее (`product`). */
  productWins?: Partial<Record<TFinanceMarketplace, number>>;
  /** Самые большие разрывы на штуку, не больше `PRODUCT_TOP` (`product`). */
  products?: ICompareProductWin[];
}

/** Площадка в сравнении: только те, у которых есть журнал за период. */
export interface ICompareEntry {
  marketplace: TFinanceMarketplace;
  current: IPnl;
  /** null — журнал прошлого периода не загружен. */
  previous: IPnl | null;
}

export const PRODUCT_TOP = 3;

export const NOT_ENOUGH_MARKETPLACES =
  'Сравнивать не с чем: данные за период есть меньше чем у двух площадок.';
export const TIE_REASON = 'Поровну — у площадок одинаковые значения.';
export const NO_SCHEME_REASON =
  'Схему продаж площадки не указывают в журнале (у Wildberries её нет) — сравнивать схемы не по чему.';
export const NO_COMMON_PRODUCTS_REASON =
  'Нет товаров с подтверждённым закупом, проданных хотя бы на двух площадках.';
export const NO_GROWTH_REASON =
  'Рост считать не от чего: прошлый период загружен и с выручкой меньше чем у двух площадок.';

const percent = (share: number) => `${(share * 100).toFixed(1).replace('.', ',')} %`;
const label = (marketplace: TFinanceMarketplace) => MARKETPLACE_LABEL[marketplace];

interface IScored {
  marketplace: TFinanceMarketplace;
  value: number;
}

/**
 * Лучший по значению. Меньше двух кандидатов — `NOT_ENOUGH_MARKETPLACES`
 * (или своя причина), ничья наверху — `TIE_REASON`: победитель не выдумывается.
 */
function pick(
  kind: TCompareConclusionKind,
  scored: IScored[],
  direction: 'max' | 'min',
  describe: (best: IScored, second: IScored) => string,
  notEnough = NOT_ENOUGH_MARKETPLACES,
): ICompareConclusion {
  const base = { kind, title: COMPARE_CONCLUSION_TITLE[kind] };
  if (scored.length < 2) return { ...base, winner: null, text: null, reason: notEnough };
  const sorted = [...scored].sort((a, b) =>
    direction === 'max' ? b.value - a.value : a.value - b.value,
  );
  const [best, second] = sorted;
  if (best.value === second.value) return { ...base, winner: null, text: null, reason: TIE_REASON };
  return { ...base, winner: best.marketplace, text: describe(best, second), reason: null };
}

function schemeConclusion(entries: readonly ICompareEntry[]): ICompareConclusion {
  const base = { kind: 'scheme' as const, title: COMPARE_CONCLUSION_TITLE.scheme };
  const schemes = entries
    .flatMap((entry) => schemeTotalsOf(entry.marketplace, entry.current))
    .filter((total): total is ISchemeTotal & { margin: number } => total.margin !== null);
  if (schemes.length < 2) {
    return {
      ...base,
      winner: null,
      text: null,
      reason: schemes.length ? NOT_ENOUGH_MARKETPLACES : NO_SCHEME_REASON,
    };
  }
  const [best, second] = [...schemes].sort((a, b) => b.margin - a.margin);
  if (best.margin === second.margin)
    return { ...base, winner: null, text: null, reason: TIE_REASON };
  return {
    ...base,
    winner: best.marketplace,
    scheme: best.scheme,
    reason: null,
    text:
      `${best.scheme} на ${label(best.marketplace)}: рентабельность ${percent(best.margin)} ` +
      `против ${percent(second.margin)} у ${second.scheme} на ${label(second.marketplace)}`,
  };
}

/**
 * Где выгоднее товар. Ключ общий у всех площадок: SKU Ozon и WB приводятся к
 * артикулу ЯМ ещё при импорте журнала (`ozon_finance_sku_resolve`). Только
 * товары с подтверждённым закупом и проданными штуками — иначе «чистая на штуку»
 * завышена или не определена.
 */
function productConclusion(entries: readonly ICompareEntry[]): ICompareConclusion {
  const base = { kind: 'product' as const, title: COMPARE_CONCLUSION_TITLE.product };
  const perUnit = new Map<string, IScored[]>();
  for (const entry of entries) {
    for (const sku of entry.current.skus.skus) {
      if (!sku.costKnown || sku.units <= 0) continue;
      const list = perUnit.get(sku.sku) ?? [];
      list.push({ marketplace: entry.marketplace, value: Math.round(sku.netKopecks / sku.units) });
      perUnit.set(sku.sku, list);
    }
  }
  const wins: ICompareProductWin[] = [];
  for (const [sku, scored] of perUnit) {
    if (scored.length < 2) continue;
    const [best, second] = [...scored].sort((a, b) => b.value - a.value);
    if (best.value === second.value) continue;
    wins.push({
      sku,
      winner: best.marketplace,
      runnerUp: second.marketplace,
      winnerPerUnitKopecks: best.value,
      runnerUpPerUnitKopecks: second.value,
    });
  }
  if (!wins.length) return { ...base, winner: null, text: null, reason: NO_COMMON_PRODUCTS_REASON };

  const productWins: Partial<Record<TFinanceMarketplace, number>> = {};
  for (const win of wins) productWins[win.winner] = (productWins[win.winner] ?? 0) + 1;
  const ranked = (Object.entries(productWins) as [TFinanceMarketplace, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const products = [...wins]
    .sort(
      (a, b) =>
        b.winnerPerUnitKopecks -
          b.runnerUpPerUnitKopecks -
          (a.winnerPerUnitKopecks - a.runnerUpPerUnitKopecks) || a.sku.localeCompare(b.sku),
    )
    .slice(0, PRODUCT_TOP);
  const tie = ranked.length > 1 && ranked[0][1] === ranked[1][1];
  const counts = ranked
    .map(([marketplace, count]) => `${label(marketplace)} — ${count}`)
    .join(', ');
  return {
    ...base,
    winner: tie ? null : ranked[0][0],
    reason: null,
    text: `Из ${wins.length} товаров, проданных на нескольких площадках, чистая на штуку выше: ${counts}`,
    productWins,
    products,
  };
}

/** Выводы в порядке `COMPARE_CONCLUSION_ORDER`. */
export function conclusionsOf(entries: readonly ICompareEntry[]): ICompareConclusion[] {
  const metrics = entries.map((entry) => ({
    marketplace: entry.marketplace,
    m: compareMetricsOf(entry.current),
  }));
  const withRevenue = metrics.filter(({ m }) => m.revenueKopecks > 0);

  const revenue = pick(
    'revenue',
    withRevenue.map(({ marketplace, m }) => ({ marketplace, value: m.revenueKopecks })),
    'max',
    (best, second) =>
      `${label(best.marketplace)}: выручка ${rubText(best.value)} — на ${rubText(best.value - second.value)} ` +
      `больше, чем у ${label(second.marketplace)}`,
  );

  const netPerOrder = pick(
    'net_per_order',
    metrics.flatMap(({ marketplace, m }) =>
      m.netPerOrderKopecks === null ? [] : [{ marketplace, value: m.netPerOrderKopecks }],
    ),
    'max',
    (best, second) =>
      `${label(best.marketplace)}: ${rubText(best.value)} чистой на заказ против ${rubText(second.value)} ` +
      `у ${label(second.marketplace)}`,
  );

  const costShare = pick(
    'cost_share',
    metrics.flatMap(({ marketplace, m }) =>
      m.costShare === null ? [] : [{ marketplace, value: m.costShare }],
    ),
    'min',
    (best, second) =>
      `${label(best.marketplace)}: услуги площадки — ${percent(best.value)} выручки против ` +
      `${percent(second.value)} у ${label(second.marketplace)}`,
  );

  const returns = pick(
    'returns',
    metrics.flatMap(({ marketplace, m }) =>
      m.returnsShare === null ? [] : [{ marketplace, value: m.returnsShare }],
    ),
    'max',
    (best, second) =>
      `${label(best.marketplace)}: возвраты — ${percent(best.value)} продаж против ` +
      `${percent(second.value)} у ${label(second.marketplace)}`,
  );

  const growth = pick(
    'growth',
    entries.flatMap((entry) => {
      const before = entry.previous?.revenueKopecks ?? 0;
      if (!(before > 0)) return [];
      return [{ marketplace: entry.marketplace, value: entry.current.revenueKopecks / before - 1 }];
    }),
    'max',
    (best, second) =>
      `${label(best.marketplace)}: выручка ${best.value >= 0 ? '+' : '−'}${percent(Math.abs(best.value))} ` +
      `к прошлому периоду против ${second.value >= 0 ? '+' : '−'}${percent(Math.abs(second.value))} ` +
      `у ${label(second.marketplace)}`,
    NO_GROWTH_REASON,
  );

  return [
    revenue,
    netPerOrder,
    costShare,
    returns,
    growth,
    schemeConclusion(entries),
    productConclusion(entries),
  ];
}
