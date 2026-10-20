import type { IUnconfirmedProfit } from '../../../shared/profit-confirmation';
import type { IFinancePeriod } from '../../finance/finance-period';
import type { TFinancePeriodStatus } from '../../finance/finance-period-status';
import type { IPnlReport } from '../../finance/finance.service';
import type { IPnlSku, IPnlSkuRest, TSkuColumns } from '../../finance/pnl-sku';

import { minPriceOf } from '../../finance/pnl-sku';

/** Формула живёт рядом с разрезом (её зовёт и ИИ-разбор, TASK-150); здесь — реэкспорт. */
export { minPriceOf };

/**
 * «Unit-экономика» CRM (TASK-138, ТЗ п.7) — таблица товаров и карточка товара
 * за период, уровня аккаунта.
 *
 * Числа — разрез `pnl.skus` того же `FinanceService.build`, что «Финансы» и
 * «Обзор»: Σ чистой товаров + «не относится к товару» = чистая P&L по
 * построению (довод — в `pnl-sku.ts`). Здесь только производные одного товара
 * (средняя цена, доли расходов, минимальная цена) и сравнение с прошлым
 * периодом — второй формулы прибыли нет.
 */

export const UNIT_ECONOMICS_KIND = 'unit-economics:skus';

export const UNIT_ECONOMICS_RANGE_INVALID_TEXT =
  'Период не распознан: нужны даты начала и конца не длиннее года';

/** Расходы, доли которых показываются от выручки. Знак журнала снят: доля — положительная. */
export const UNIT_EXPENSE_COLUMNS = [
  'commission',
  'logistics',
  'promotion',
  'otherServices',
] as const satisfies readonly (keyof TSkuColumns)[];

export type TUnitExpenseColumn = (typeof UNIT_EXPENSE_COLUMNS)[number];

export interface ICrmUnitScheme {
  /** FBS / FBY; null — площадка схему не указала. */
  scheme: string | null;
  units: number;
  revenueKopecks: number;
  netKopecks: number;
}

export interface ICrmUnitPrevious {
  revenueKopecks: number;
  netKopecks: number;
  units: number;
  margin: number | null;
}

export interface ICrmUnitSku {
  sku: string;
  /** Название из базы товаров; null — товара нет в базе. */
  name: string | null;
  /** FBS / FBY, если товар продавался по одной схеме; null — по нескольким или неизвестно. */
  scheme: string | null;
  units: number;
  orders: number;
  /** false — у части проданного нет закупа: себестоимость и прибыль не подтверждены. */
  costKnown: boolean;
  columns: TSkuColumns;
  cogsKopecks: number;
  taxKopecks: number;
  netKopecks: number;
  /** Выручка / штуки; null — штук нет. */
  avgPriceKopecks: number | null;
  unitCostKopecks: number | null;
  /** Средняя прибыль на штуку. */
  unitNetKopecks: number | null;
  /** Чистая / выручка; null — выручки нет. */
  margin: number | null;
  /** Доля расхода в выручке (0.23 = 23 %); null — выручки нет. */
  shares: Record<TUnitExpenseColumn | 'cogs' | 'tax', number | null>;
  /** Цена, при которой прибыль штуки = 0; null — не посчитать (см. `minPriceOf`). */
  minPriceKopecks: number | null;
  /** null — в прошлом периоде товар не продавался и расходов не имел. */
  previous: ICrmUnitPrevious | null;
  schemes: ICrmUnitScheme[];
}

export interface ICrmUnitRest {
  columns: TSkuColumns;
  taxKopecks: number;
  operatingKopecks: number;
  netKopecks: number;
  lines: number;
}

export interface ICrmUnitEconomics {
  period: IFinancePeriod;
  previousPeriod: IFinancePeriod;
  status: TFinancePeriodStatus;
  statusLabel: string;
  /** Чистая P&L периода — та же, что в «Финансах»; Σ товаров + rest = ей. */
  netKopecks: number;
  revenueKopecks: number;
  /** Признак движка (TASK-119): продажи за период без закупа — прибыль не подтверждена. */
  unconfirmed: IUnconfirmedProfit;
  skus: ICrmUnitSku[];
  rest: ICrmUnitRest;
}

const perUnit = (kopecks: number, units: number): number | null =>
  units > 0 ? Math.round(kopecks / units) : null;

const share = (part: number, revenue: number): number | null =>
  revenue > 0 ? part / revenue : null;

function sharesOf(sku: IPnlSku): ICrmUnitSku['shares'] {
  const revenue = sku.columns.revenue;
  const shares = {} as ICrmUnitSku['shares'];
  for (const column of UNIT_EXPENSE_COLUMNS) shares[column] = share(-sku.columns[column], revenue);
  shares.cogs = share(sku.cogsKopecks, revenue);
  shares.tax = share(sku.taxKopecks, revenue);
  return shares;
}

function previousOf(sku: IPnlSku | undefined): ICrmUnitPrevious | null {
  if (!sku) return null;
  return {
    revenueKopecks: sku.columns.revenue,
    netKopecks: sku.netKopecks,
    units: sku.units,
    margin: share(sku.netKopecks, sku.columns.revenue),
  };
}

function toUnitSku(
  sku: IPnlSku,
  previous: IPnlSku | undefined,
  names: ReadonlyMap<string, string>,
): ICrmUnitSku {
  return {
    sku: sku.sku,
    name: names.get(sku.sku) ?? null,
    scheme: sku.scheme,
    units: sku.units,
    orders: sku.orders,
    costKnown: sku.costKnown,
    columns: { ...sku.columns },
    cogsKopecks: sku.cogsKopecks,
    taxKopecks: sku.taxKopecks,
    netKopecks: sku.netKopecks,
    avgPriceKopecks: perUnit(sku.columns.revenue, sku.units),
    unitCostKopecks: perUnit(sku.cogsKopecks, sku.units),
    unitNetKopecks: perUnit(sku.netKopecks, sku.units),
    margin: share(sku.netKopecks, sku.columns.revenue),
    shares: sharesOf(sku),
    minPriceKopecks: minPriceOf(sku),
    previous: previousOf(previous),
    schemes: sku.schemes.map((part) => ({
      scheme: part.scheme,
      units: part.units,
      revenueKopecks: part.columns.revenue,
      netKopecks: part.netKopecks,
    })),
  };
}

function toUnitRest(rest: IPnlSkuRest): ICrmUnitRest {
  return {
    columns: { ...rest.columns },
    taxKopecks: rest.taxKopecks,
    operatingKopecks: rest.operatingKopecks,
    netKopecks: rest.netKopecks,
    lines: rest.lines,
  };
}

/** Ответ раздела: товары по выручке, крупные первыми; прошлый период — по артикулу. */
export function toCrmUnitEconomics(
  current: IPnlReport,
  previous: IPnlReport,
  names: ReadonlyMap<string, string>,
): ICrmUnitEconomics {
  const previousBySku = new Map(previous.pnl.skus.skus.map((sku) => [sku.sku, sku]));
  const skus = current.pnl.skus.skus
    .map((sku) => toUnitSku(sku, previousBySku.get(sku.sku), names))
    .sort((a, b) => b.columns.revenue - a.columns.revenue || a.sku.localeCompare(b.sku));

  return {
    period: current.pnl.period,
    previousPeriod: previous.pnl.period,
    status: current.status,
    statusLabel: current.statusLabel,
    netKopecks: current.pnl.netKopecks,
    revenueKopecks: current.pnl.revenueKopecks,
    unconfirmed: current.pnl.unconfirmed,
    skus,
    rest: toUnitRest(current.pnl.skus.rest),
  };
}
