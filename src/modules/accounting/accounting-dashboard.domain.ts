/**
 * Панель «Финучёта» (ТЗ п.13, TASK-229): итоги периода по строкам в одном из
 * трёх базисов. Чистый модуль — сервис собирает строки-«кирпичи» (`IDashboardItem`)
 * из карточек заказов, журнала, ручных операций, расходов, налога и ДДС, а здесь
 * они только раскладываются по площадкам и суммируются. Своих формул прибыли нет:
 * в базисе «продажа» кирпичи — суммы карточек (`orderProfitStateOf`).
 *
 * Знак журнала: «+» — деньги продавцу, «−» — удержано. Неизвестное — `null`,
 * никогда не 0: одна неизвестная себестоимость делает неизвестными валовую и
 * чистую прибыль и рентабельность (`accounting_unknown_is_null`).
 */

import type { IOrderCardOperation } from './accounting-order-card.domain';
import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { IOrderProfit } from './order-profit-state';
import type { TOrderResultKey } from './order-result';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TFinanceArticle } from '../finance/finance-articles';
import type { IFinancePeriod } from '../finance/finance-period';
import type { TBrandKey } from '../yandex/reports/brands';

import { MARKETPLACE_LABEL } from '../../shared/marketplace';
import { FINANCE_ARTICLE_META } from '../finance/finance-articles';
import { brandOf } from '../yandex/reports/brands';

import { orderKeyOf } from './accounting-order-card.domain';
import { ORDER_RESULT_KEY_OF_ARTICLE } from './order-result';

/** Базис периода — обязательный: от него зависит, какие операции попадут в итог. */
export type TDashboardBasis = 'sale' | 'accrual' | 'cash';

export const DASHBOARD_BASIS_TITLE: Record<TDashboardBasis, string> = {
  sale: 'По дате продажи',
  accrual: 'По дате начисления',
  cash: 'По движению денег',
};

export const DASHBOARD_BASIS_HINT: Record<TDashboardBasis, string> = {
  sale:
    'Заказы, оформленные в периоде, целиком — как в их карточках, с распределёнными рекламой, ' +
    'расходами и налогом и с ожидаемыми суммами по ещё не начисленным операциям.',
  accrual:
    'Операции площадок и ручные операции, начисленные в периоде; себестоимость — заказов, ' +
    'чья продажа начислена в периоде; налог и расходы — за период.',
  cash:
    'Деньги, пришедшие и ушедшие в периоде: выплаты площадок по статьям, оплаты закупа, ' +
    'уплаченный налог и оплаченные расходы.',
};

/** Строка панели. Порядок ключей `DASHBOARD_LINE_TITLE` — порядок на экране. */
export type TDashboardLine =
  | 'revenue'
  | 'returns'
  | 'compensations'
  | 'cogs'
  | 'commission'
  | 'logistics'
  | 'marketplace_services'
  | 'advertising'
  | 'tax'
  | 'opex';

export const DASHBOARD_LINE_TITLE: Record<TDashboardLine, string> = {
  revenue: 'Выручка',
  returns: 'Возвраты',
  compensations: 'Компенсации и прочие доходы',
  cogs: 'Себестоимость',
  commission: 'Комиссии',
  logistics: 'Логистика',
  marketplace_services: 'Прочие услуги площадки',
  advertising: 'Реклама',
  tax: 'Налоги',
  opex: 'Операционные расходы',
};

/** В базисе «деньги» те же строки — это платежи, а не признанные суммы. */
const CASH_LINE_TITLE: Partial<Record<TDashboardLine, string>> = {
  cogs: 'Оплаты закупа',
  tax: 'Уплаченный налог',
  opex: 'Оплаченные расходы',
};

export const DASHBOARD_LINES = Object.keys(DASHBOARD_LINE_TITLE) as TDashboardLine[];

export function dashboardLineTitle(basis: TDashboardBasis, line: TDashboardLine): string {
  return (basis === 'cash' ? CASH_LINE_TITLE[line] : undefined) ?? DASHBOARD_LINE_TITLE[line];
}

/**
 * Строка карточки заказа → строка панели. `Record` — новая строка карточки без
 * места на панели не скомпилируется. `revenue` карточки делится на выручку и
 * возвраты по статьям операций (`saleItemsOf`), решение `accounting_dashboard_returns`.
 */
export const DASHBOARD_LINE_OF_RESULT_KEY: Record<TOrderResultKey, TDashboardLine> = {
  revenue: 'revenue',
  commission: 'commission',
  acquiring: 'commission',
  delivery: 'logistics',
  reverse_logistics: 'logistics',
  other_services: 'marketplace_services',
  advertising: 'advertising',
  advertising_allocated: 'advertising',
  opex_allocated: 'opex',
  other_expenses: 'opex',
  compensations: 'compensations',
  cogs: 'cogs',
  cogs_write_off: 'cogs',
  tax_allocated: 'tax',
};

/**
 * Статья журнала → строка панели: через строку карточки (`ORDER_RESULT_KEY_OF_ARTICLE`),
 * чтобы панель и карточка не разошлись; `returns` — своя строка. `reference` — вне суммы.
 */
export function dashboardLineOfArticle(article: TFinanceArticle): TDashboardLine | 'reference' {
  if (article === 'returns') return 'returns';
  const key = ORDER_RESULT_KEY_OF_ARTICLE[article];
  return key === 'reference' ? 'reference' : DASHBOARD_LINE_OF_RESULT_KEY[key];
}

export type TDashboardSource = 'journal' | 'manual' | 'order' | 'expense' | 'purchase' | 'tax';

/** Кирпич итога: одна операция, одна сумма карточки или один платёж/расход. */
export interface IDashboardItem {
  /** null — уровень кабинета: в итог площадки не входит, только в «Все площадки». */
  marketplace: TFinanceMarketplace | null;
  line: TDashboardLine;
  /** Копейки со знаком журнала; null — неизвестно. */
  kopecks: number | null;
  /** Ожидаемая сумма карточки (операции ещё не начислены). */
  expected: boolean;
  source: TDashboardSource;
  /** Операции журнала/ручные, из которых сумма. */
  operationIds: string[];
  /** Расход, оплата закупа, платёж налога — id своей записи. */
  refId: string | null;
  /** Заказ (`orderKeyOf`); null — не заказа. */
  orderKey: string | null;
  /** Артикул продавца; null — не товара (или сумма всего заказа). */
  sku: string | null;
  title: string;
  reason: string | null;
}

export interface IDashboardOrder {
  key: string;
  marketplace: TFinanceMarketplace;
  orderId: string;
  lines: readonly IAccountingOrderLineInput[];
  operations: readonly IOrderCardOperation[];
  profit: IOrderProfit;
}

/** Операция журнала или ручная → кирпич; справочная (баллы) — null. */
export function operationItemOf(op: IOrderCardOperation): IDashboardItem | null {
  const line = dashboardLineOfArticle(op.article);
  if (line === 'reference') return null;
  return {
    marketplace: op.marketplace,
    line,
    kopecks: op.amountKopecks,
    expected: false,
    source: op.origin === 'manual' ? 'manual' : 'journal',
    operationIds: [op.id],
    refId: null,
    orderKey: op.orderId ? orderKeyOf(op.marketplace, op.orderId) : null,
    sku: op.sku ?? null,
    title: op.serviceName ?? FINANCE_ARTICLE_META[op.article].title,
    reason: null,
  };
}

/**
 * Суммы карточки заказа → кирпичи (базис «продажа»). `revenue` делится: строки
 * статьи `returns` — «Возвраты», остальное — «Выручка»; Σ двух = сумме карточки.
 * Строки `only` — только эти строки панели (себестоимость в базисе «начисление»).
 */
export function saleItemsOf(
  order: IDashboardOrder,
  only?: ReadonlySet<TDashboardLine>,
): IDashboardItem[] {
  const items: IDashboardItem[] = [];
  const base = {
    marketplace: order.marketplace,
    refId: null,
    orderKey: order.key,
    sku: null,
  };
  for (const amount of order.profit.amounts) {
    const line = DASHBOARD_LINE_OF_RESULT_KEY[amount.key];
    const expected = amount.source === 'expected';
    const reason = amount.reason ?? null;
    if (amount.key === 'revenue' && amount.operationIds.length) {
      const ids = new Set(amount.operationIds);
      const returns = order.operations.filter(
        (op) =>
          ids.has(op.id) &&
          op.article === 'returns' &&
          ORDER_RESULT_KEY_OF_ARTICLE[op.article] === 'revenue',
      );
      if (returns.length) {
        const returnIds = new Set(returns.map((op) => op.id));
        const returnsKopecks = returns.reduce((sum, op) => sum + op.amountKopecks, 0);
        if (!only || only.has('returns')) {
          items.push({
            ...base,
            line: 'returns',
            kopecks: returnsKopecks,
            expected,
            source: 'order',
            operationIds: [...returnIds],
            title: DASHBOARD_LINE_TITLE.returns,
            reason,
          });
        }
        if (!only || only.has('revenue')) {
          items.push({
            ...base,
            line: 'revenue',
            kopecks: amount.kopecks === null ? null : amount.kopecks - returnsKopecks,
            expected,
            source: 'order',
            operationIds: amount.operationIds.filter((id) => !returnIds.has(id)),
            title: amount.title,
            reason,
          });
        }
        continue;
      }
    }
    if (only && !only.has(line)) continue;
    items.push({
      ...base,
      line,
      kopecks: amount.kopecks,
      expected,
      source: 'order',
      operationIds: [...amount.operationIds],
      title: amount.title,
      reason,
    });
  }
  return items;
}

/** День оформления заказа — тот же, что выбирает его месяц (`orderMonthOf`). */
export function orderCreatedOn(lines: readonly IAccountingOrderLineInput[]): string | null {
  return lines.map((l) => l.createdOn ?? l.soldOn).find((d): d is string => Boolean(d)) ?? null;
}

export const inDashboardPeriod = (day: string | null, period: IFinancePeriod): boolean =>
  day !== null && day >= period.from && day <= period.to;

// ── Фильтры ────────────────────────────────────────────────────────────────

export interface IDashboardFilter {
  marketplace?: TFinanceMarketplace | null;
  brand?: TBrandKey | null;
  offerId?: string | null;
  orderId?: string | null;
}

/** Товарный фильтр — артикул, бренд или заказ: общие строки при нём не делятся. */
export function hasItemFilter(filter: IDashboardFilter): boolean {
  return Boolean(filter.brand || filter.offerId || filter.orderId);
}

/** Что известно о заказах периода: товары заказа и названия артикулов. */
export interface IDashboardCatalog {
  skusOf: ReadonlyMap<string, ReadonlySet<string>>;
  nameOf: ReadonlyMap<string, string>;
}

export function catalogOf(lines: readonly IAccountingOrderLineInput[]): IDashboardCatalog {
  const skusOf = new Map<string, Set<string>>();
  const nameOf = new Map<string, string>();
  for (const line of lines) {
    if (!line.offerId) continue;
    const key = orderKeyOf(line.marketplace, line.orderId);
    const set = skusOf.get(key) ?? new Set<string>();
    set.add(line.offerId);
    skusOf.set(key, set);
    if (line.offerName && !nameOf.has(line.offerId)) nameOf.set(line.offerId, line.offerName);
  }
  return { skusOf, nameOf };
}

function skusOfItem(item: IDashboardItem, catalog: IDashboardCatalog): string[] {
  if (item.sku) return [item.sku];
  return item.orderKey ? [...(catalog.skusOf.get(item.orderKey) ?? [])] : [];
}

function orderIdOfKey(key: string | null): string | null {
  return key ? key.slice(key.indexOf('|') + 1) : null;
}

export interface IDashboardFiltered {
  items: IDashboardItem[];
  /** Сколько кирпичей не вошло: общие строки при товарном фильтре и строки кабинета при фильтре площадки. */
  droppedCount: number;
}

/**
 * Отбор кирпичей. Площадка — свои кирпичи, строки кабинета выпадают (их не
 * поделить). Заказ — кирпичи этого заказа. Артикул и бренд — кирпичи товара или
 * заказа, в котором он есть (сумма заказа целиком — она не делится по товарам).
 * Кирпич без заказа и товара при товарном фильтре выпадает.
 */
export function filterDashboardItems(
  items: readonly IDashboardItem[],
  filter: IDashboardFilter,
  catalog: IDashboardCatalog,
): IDashboardFiltered {
  const kept = items.filter((item) => {
    if (filter.marketplace && item.marketplace !== filter.marketplace) return false;
    if (filter.orderId && orderIdOfKey(item.orderKey) !== filter.orderId) return false;
    if (filter.offerId && !skusOfItem(item, catalog).includes(filter.offerId)) return false;
    if (filter.brand) {
      const brands = skusOfItem(item, catalog).map((sku) =>
        brandOf({ name: catalog.nameOf.get(sku) ?? '' }),
      );
      if (!brands.includes(filter.brand)) return false;
    }
    return true;
  });
  return { items: kept, droppedCount: items.length - kept.length };
}

// ── Итоги ──────────────────────────────────────────────────────────────────

export interface IDashboardLineTotal {
  line: TDashboardLine;
  title: string;
  /** Σ кирпичей; null — хоть один неизвестен. */
  kopecks: number | null;
  /** Из них ожидаемое (только базис «продажа»). */
  expectedKopecks: number;
  count: number;
  /** Первая причина неизвестной суммы. */
  unknownReason: string | null;
}

export interface IDashboardMoney {
  /** К выплате на сегодня — начислено, не выплачено (`receivableOf`). */
  payableKopecks: number | null;
  /** Уже получено в периоде — выплаты (`payoutsOf`). */
  receivedKopecks: number | null;
}

export interface IDashboardBlock extends IDashboardMoney {
  /** null — «Все площадки». */
  marketplace: TFinanceMarketplace | null;
  label: string;
  lines: IDashboardLineTotal[];
  /** Выручка + возвраты + себестоимость; null — себестоимость неизвестна. */
  grossKopecks: number | null;
  /** Σ всех строк; null — какая-то строка неизвестна. */
  netKopecks: number | null;
  /** Чистая прибыль к выручке за вычетом возвратов, %, один знак; null — не считается. */
  marginPercent: number | null;
  /** В блоке площадки нет строк уровня кабинета (налог, закуп, общие расходы). */
  excludesAccountLevel: boolean;
}

export const ALL_MARKETPLACES_LABEL = 'Все площадки';

function sumOrNull(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total + 0;
}

function lineTotalsOf(
  basis: TDashboardBasis,
  items: readonly IDashboardItem[],
): IDashboardLineTotal[] {
  return DASHBOARD_LINES.map((line) => {
    const own = items.filter((item) => item.line === line);
    const unknown = own.find((item) => item.kopecks === null);
    return {
      line,
      title: dashboardLineTitle(basis, line),
      kopecks: sumOrNull(own.map((item) => item.kopecks)),
      expectedKopecks: own.reduce(
        (sum, item) => (item.expected && item.kopecks !== null ? sum + item.kopecks : sum),
        0,
      ),
      count: own.length,
      unknownReason: unknown ? (unknown.reason ?? 'unknown') : null,
    };
  });
}

function blockOf(
  basis: TDashboardBasis,
  marketplace: TFinanceMarketplace | null,
  items: readonly IDashboardItem[],
  money: IDashboardMoney,
  excludesAccountLevel: boolean,
): IDashboardBlock {
  const lines = lineTotalsOf(basis, items);
  const of = (line: TDashboardLine) => lines.find((l) => l.line === line)?.kopecks ?? null;
  const netRevenue = sumOrNull([of('revenue'), of('returns')]);
  const grossKopecks = sumOrNull([netRevenue, of('cogs')]);
  const netKopecks = sumOrNull(lines.map((l) => l.kopecks));
  const marginPercent =
    netKopecks === null || netRevenue === null || netRevenue <= 0
      ? null
      : Math.round((netKopecks / netRevenue) * 1000) / 10;
  return {
    marketplace,
    label: marketplace ? MARKETPLACE_LABEL[marketplace] : ALL_MARKETPLACES_LABEL,
    lines,
    grossKopecks,
    netKopecks,
    marginPercent,
    excludesAccountLevel,
    ...money,
  };
}

export interface IDashboardTotals {
  byMarketplace: IDashboardBlock[];
  /**
   * Сумма площадок с подписью «Все площадки» — только когда площадок больше
   * одной или есть строки кабинета; иначе null (площадки в одно число без
   * подписи не складываются).
   */
  all: IDashboardBlock | null;
}

/**
 * Итоги: блок на каждую площадку (без строк кабинета) и, если нужно, «Все
 * площадки» — все кирпичи, деньги — Σ площадок (null, если у какой-то null).
 */
export function dashboardTotalsOf(
  basis: TDashboardBasis,
  items: readonly IDashboardItem[],
  marketplaces: readonly TFinanceMarketplace[],
  moneyOf: (marketplace: TFinanceMarketplace) => IDashboardMoney,
): IDashboardTotals {
  const accountLevel = items.some((item) => item.marketplace === null);
  const byMarketplace = marketplaces.map((marketplace) =>
    blockOf(
      basis,
      marketplace,
      items.filter((item) => item.marketplace === marketplace),
      moneyOf(marketplace),
      accountLevel,
    ),
  );
  if (marketplaces.length < 2 && !accountLevel) return { byMarketplace, all: null };
  return {
    byMarketplace,
    all: blockOf(
      basis,
      null,
      items,
      {
        payableKopecks: sumOrNull(byMarketplace.map((b) => b.payableKopecks)),
        receivedKopecks: sumOrNull(byMarketplace.map((b) => b.receivedKopecks)),
      },
      false,
    ),
  };
}

// ── Раскрытие ──────────────────────────────────────────────────────────────

/** Кирпичи одной строки одного блока (`marketplace: null` — «Все площадки»). */
export function drillItemsOf(
  items: readonly IDashboardItem[],
  line: TDashboardLine,
  marketplace: TFinanceMarketplace | null,
): IDashboardItem[] {
  return items.filter(
    (item) => item.line === line && (marketplace === null || item.marketplace === marketplace),
  );
}
