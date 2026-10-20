/**
 * Разрез P&L по товару (TASK-138, ТЗ п.7, unit-экономика). Чистая функция —
 * её зовёт `pnlOf` на ТЕХ ЖЕ строках периода и ТОЙ ЖЕ себестоимости, что идут
 * в итог. Поэтому Σ чистой по товарам + «не относится к товару» = чистой P&L
 * по построению, а не сверкой двух расчётов (довод `byDay`/`bySku` «Прибыли»).
 *
 * Куда идёт строка журнала:
 * - есть артикул — целиком этому артикулу;
 * - артикула нет, но есть заказ (комиссия, доставка по заказу) — делится между
 *   артикулами заказа пропорционально их продаже в заказе: по позициям Маркет
 *   такие услуги не раскладывает (довод `itemShares` в profit.ts). Нет продажи
 *   с артикулом — по штукам, нет и их — в «не относится к товару»;
 * - ни артикула, ни заказа (подписка, хранение, пуши) — не делится, остаётся
 *   строкой «не относится к товару». Туда же — операционные расходы бизнеса.
 *
 * Налог в журнале не лежит: он считается на весь период (`taxOf`, по своей
 * дате признания) и раскладывается по доле товара в налоговой базе периода
 * (выручка + прочие доходы). Это приближение: доход, начисленный в одном
 * месяце, а признанный в другом, раскладывается по начислению.
 *
 * Деньги — целые копейки; при делении остаток отдаётся наибольшим дробным
 * частям, так что Σ кусков = исходной сумме до копейки.
 */

import type { TFinanceArticle } from './finance-articles';
import type { IPnlLine } from './pnl';

/** Колонка unit-экономики. Подписи — на экране; здесь только смысл. */
export type TSkuColumn =
  | 'revenue'
  | 'otherIncome'
  | 'commission'
  | 'logistics'
  | 'promotion'
  | 'otherServices'
  | 'unrecognized';

export const SKU_COLUMNS: readonly TSkuColumn[] = [
  'revenue',
  'otherIncome',
  'commission',
  'logistics',
  'promotion',
  'otherServices',
  'unrecognized',
];

/**
 * Статья → колонка. `Record`, а не список: новая статья не скомпилируется без
 * решения, где она в unit-экономике. null — вне денег (справочный бонусный
 * баланс), как и в уровнях P&L.
 *
 * Эквайринг — вместе с комиссией: оба берутся процентом от цены, и для
 * минимальной цены они ведут себя одинаково.
 */
export const SKU_COLUMN_OF: Readonly<Record<TFinanceArticle, TSkuColumn | null>> = {
  sales: 'revenue',
  returns: 'revenue',
  subsidies: 'revenue',
  compensations: 'otherIncome',
  other_income: 'otherIncome',
  commission: 'commission',
  acquiring: 'commission',
  delivery_to_buyer: 'logistics',
  reverse_logistics: 'logistics',
  promotion: 'promotion',
  paid_options: 'promotion',
  storage: 'otherServices',
  acceptance: 'otherServices',
  processing: 'otherServices',
  penalties: 'otherServices',
  withholdings: 'otherServices',
  subscription: 'otherServices',
  other_services: 'otherServices',
  unknown: 'unrecognized',
  bonus_payment: null,
};

export type TSkuColumns = Record<TSkuColumn, number>;

/** Деньги одного куска разреза — товара в схеме или «не относится к товару». */
export interface IPnlSkuMoney {
  /** Колонки журнала со знаком площадки: доходы «+», услуги «−». */
  columns: TSkuColumns;
  /** Себестоимость проданного минус вернувшегося, копейки (≥ 0 обычно). */
  cogsKopecks: number;
  /** Доля налога периода. */
  taxKopecks: number;
  /** Σ колонок − себестоимость − налог (у «не относится» — ещё − опер. расходы). */
  netKopecks: number;
}

export interface IPnlSkuScheme extends IPnlSkuMoney {
  /** FBS / FBY / …; null — площадка схему не указала. */
  scheme: string | null;
  /** Продано минус вернулось, штук — включая позиции без закупа. */
  units: number;
  /** Различных заказов со строкой продажи этого артикула. */
  orders: number;
}

export interface IPnlSku extends IPnlSkuScheme {
  sku: string;
  /** false — у части проданного нет закупа на дату: себестоимость и чистая не подтверждены. */
  costKnown: boolean;
  /** По схемам; у большинства товаров одна. */
  schemes: IPnlSkuScheme[];
}

export interface IPnlSkuRest extends IPnlSkuMoney {
  /** Операционные расходы бизнеса периода — целиком здесь, по товарам не делятся. */
  operatingKopecks: number;
  /** Строк журнала, которые не удалось отнести к товару. */
  lines: number;
  /**
   * Штуки строк, двигающих товар, но без артикула (TASK-140): Σ штук товаров +
   * эти = `pnl.units`, иначе разрез «Аналитики продаж» по товарам не сходился бы с итогом.
   */
  units: number;
}

export interface IPnlSkuBreakdown {
  skus: IPnlSku[];
  /** Подписка, хранение, заказы без артикула, опер. расходы — «не относится к товару». */
  rest: IPnlSkuRest;
}

export interface IPnlSkuInput {
  /** Строки, начисленные в периоде, — те же, что легли в корзины статей. */
  accrued: readonly IPnlLine[];
  /** Все строки входа: веса заказа ищутся и в продажах вне периода. */
  all: readonly IPnlLine[];
  /** Себестоимость строки, копейки со знаком; нет — закуп неизвестен или строка товар не двигает. */
  lineCogs: ReadonlyMap<string, number>;
  /** Строки, двигающие товар, без закупа на дату. */
  unknownCostLines: ReadonlySet<string>;
  taxKopecks: number;
  operatingKopecks: number;
}

const emptyColumns = (): TSkuColumns => ({
  revenue: 0,
  otherIncome: 0,
  commission: 0,
  logistics: 0,
  promotion: 0,
  otherServices: 0,
  unrecognized: 0,
});

const columnsSum = (columns: TSkuColumns): number =>
  SKU_COLUMNS.reduce((sum, key) => sum + columns[key], 0);

/** База налога куска: выручка + прочие доходы (те же статьи, что TAX_BASE_ARTICLES). */
const taxBaseOf = (columns: TSkuColumns): number => columns.revenue + columns.otherIncome;

const validCount = (count: number | null): count is number =>
  typeof count === 'number' && Number.isInteger(count) && count > 0;

/**
 * Делит целые копейки по весам. Остаток — наибольшим дробным частям, при
 * равенстве — по порядку весов: результат детерминирован, Σ = `amount`.
 */
export function splitKopecks(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) throw new Error('splitKopecks: сумма весов должна быть > 0');
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const raw = weights.map((w) => (abs * w) / total);
  const parts = raw.map(Math.floor);
  let left = abs - parts.reduce((sum, p) => sum + p, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts.map((p) => sign * p);
}

interface ISlice {
  sku: string;
  scheme: string | null;
  columns: TSkuColumns;
  cogsKopecks: number;
  units: number;
  orders: Set<string>;
  costKnown: boolean;
}

const sliceKey = (sku: string, scheme: string | null) => `${sku}\u0000${scheme ?? ''}`;

/**
 * Веса артикулов в заказе: Σ продажи артикула в заказе по всем строкам входа
 * (заказ мог быть продан в прошлом месяце, а доставка начислена в этом).
 * Нет продаж с артикулом — по штукам строк, двигающих товар.
 */
function orderWeights(all: readonly IPnlLine[]): Map<string, Map<string, number>> {
  const bySales = new Map<string, Map<string, number>>();
  const byUnits = new Map<string, Map<string, number>>();
  const add = (target: Map<string, Map<string, number>>, order: string, sku: string, w: number) => {
    const skus = target.get(order) ?? new Map<string, number>();
    skus.set(sku, (skus.get(sku) ?? 0) + w);
    target.set(order, skus);
  };

  for (const line of all) {
    if (!line.orderId || !line.sku) continue;
    if (line.article === 'sales' && line.amountKopecks > 0) {
      add(bySales, line.orderId, line.sku, line.amountKopecks);
    }
    if (line.goods === 'sold' && validCount(line.count)) {
      add(byUnits, line.orderId, line.sku, line.count);
    }
  }

  const weights = new Map<string, Map<string, number>>();
  for (const order of new Set([...bySales.keys(), ...byUnits.keys()])) {
    weights.set(order, bySales.get(order) ?? (byUnits.get(order) as Map<string, number>));
  }
  return weights;
}

/** Разрез периода по товарам и схемам. */
export function skuBreakdownOf(input: IPnlSkuInput): IPnlSkuBreakdown {
  const weights = orderWeights(input.all);
  const slices = new Map<string, ISlice>();
  const rest = emptyColumns();
  let restLines = 0;
  let restUnits = 0;

  const slice = (sku: string, scheme: string | null): ISlice => {
    const key = sliceKey(sku, scheme);
    let entry = slices.get(key);
    if (!entry) {
      entry = {
        sku,
        scheme,
        columns: emptyColumns(),
        cogsKopecks: 0,
        units: 0,
        orders: new Set(),
        costKnown: true,
      };
      slices.set(key, entry);
    }
    return entry;
  };

  for (const line of input.accrued) {
    const column = SKU_COLUMN_OF[line.article];
    const scheme = line.scheme ?? null;

    if (line.sku) {
      // Справочная строка с артикулом не заводит товару пустую строку.
      if (!column && !line.goods) continue;
      const target = slice(line.sku, scheme);
      if (column) target.columns[column] += line.amountKopecks;
      if (line.article === 'sales' && line.orderId) target.orders.add(line.orderId);
      if (line.goods && validCount(line.count)) {
        target.units += (line.goods === 'sold' ? 1 : -1) * line.count;
      }
      // Закуп — только у строки, двигающей товар: части одной операции Ozon
      // (TASK-131) несут тот же id, и комиссия иначе принесла бы его ещё раз.
      if (line.goods) {
        const cogs = input.lineCogs.get(line.id);
        if (cogs !== undefined) target.cogsKopecks += cogs;
        if (input.unknownCostLines.has(line.id)) target.costKnown = false;
      }
      continue;
    }

    if (line.goods && validCount(line.count)) {
      restUnits += (line.goods === 'sold' ? 1 : -1) * line.count;
    }
    const orderSkus = line.orderId ? weights.get(line.orderId) : undefined;
    if (!column) continue;
    if (!orderSkus || orderSkus.size === 0) {
      rest[column] += line.amountKopecks;
      restLines += 1;
      continue;
    }

    const skus = [...orderSkus.keys()];
    const parts = splitKopecks(line.amountKopecks, [...orderSkus.values()]);
    skus.forEach((sku, index) => {
      slice(sku, scheme).columns[column] += parts[index];
    });
  }

  const ordered = [...slices.values()];
  const taxes = allocateTax(input.taxKopecks, ordered, rest);

  const schemesOf = new Map<string, IPnlSkuScheme[]>();
  const costKnown = new Map<string, boolean>();
  const orders = new Map<string, Set<string>>();
  ordered.forEach((entry, index) => {
    const taxKopecks = taxes.slices[index];
    const scheme: IPnlSkuScheme = {
      scheme: entry.scheme,
      columns: entry.columns,
      cogsKopecks: entry.cogsKopecks,
      taxKopecks,
      netKopecks: columnsSum(entry.columns) - entry.cogsKopecks - taxKopecks,
      units: entry.units,
      orders: entry.orders.size,
    };
    schemesOf.set(entry.sku, [...(schemesOf.get(entry.sku) ?? []), scheme]);
    costKnown.set(entry.sku, (costKnown.get(entry.sku) ?? true) && entry.costKnown);
    const skuOrders = orders.get(entry.sku) ?? new Set<string>();
    entry.orders.forEach((order) => skuOrders.add(order));
    orders.set(entry.sku, skuOrders);
  });

  const skus: IPnlSku[] = [...schemesOf.entries()].map(([sku, schemes]) => {
    const columns = emptyColumns();
    let cogsKopecks = 0;
    let taxKopecks = 0;
    let units = 0;
    for (const part of schemes) {
      for (const key of SKU_COLUMNS) columns[key] += part.columns[key];
      cogsKopecks += part.cogsKopecks;
      taxKopecks += part.taxKopecks;
      units += part.units;
    }
    return {
      sku,
      scheme: schemes.length === 1 ? schemes[0].scheme : null,
      columns,
      cogsKopecks,
      taxKopecks,
      netKopecks: columnsSum(columns) - cogsKopecks - taxKopecks,
      units,
      orders: (orders.get(sku) as Set<string>).size,
      costKnown: costKnown.get(sku) as boolean,
      schemes,
    };
  });

  return {
    skus,
    rest: {
      columns: rest,
      cogsKopecks: 0,
      taxKopecks: taxes.rest,
      operatingKopecks: input.operatingKopecks,
      netKopecks: columnsSum(rest) - taxes.rest - input.operatingKopecks,
      lines: restLines,
      units: restUnits,
    },
  };
}

/**
 * Налог периода — по доле в налоговой базе. Отрицательная база (возвратов
 * больше продаж) налог не получает. Базы нет вовсе — налог целиком в «не
 * относится к товару»: делить не по чему, а терять копейки нельзя.
 */
function allocateTax(
  taxKopecks: number,
  slices: readonly ISlice[],
  rest: TSkuColumns,
): { slices: number[]; rest: number } {
  const zero = slices.map(() => 0);
  if (taxKopecks === 0) return { slices: zero, rest: 0 };
  const weights = [...slices.map((entry) => taxBaseOf(entry.columns)), taxBaseOf(rest)].map((w) =>
    Math.max(w, 0),
  );
  if (!(weights.reduce((sum, w) => sum + w, 0) > 0)) return { slices: zero, rest: taxKopecks };
  const parts = splitKopecks(taxKopecks, weights);
  return { slices: parts.slice(0, -1), rest: parts[parts.length - 1] };
}

/**
 * Минимальная цена штуки при прибыли 0. Расходы делятся на две природы:
 * процентные от цены — комиссия с эквайрингом, продвижение и налог; на штуку —
 * закуп, логистика и прочие услуги. Тогда цена p даёт прибыль 0 при
 * p = F / (1 − r), где F — расходы на штуку, r — доля процентных в выручке.
 *
 * null, когда честно не посчитать: штук или выручки нет, закуп не подтверждён
 * (нижняя граница по неполному закупу обманула бы), или процентные расходы
 * съедают всю цену (r ≥ 1).
 */
export function minPriceOf(sku: IPnlSku): number | null {
  const revenue = sku.columns.revenue;
  if (!(sku.units > 0) || !(revenue > 0) || !sku.costKnown) return null;
  const variable = -sku.columns.commission - sku.columns.promotion + sku.taxKopecks;
  const rate = variable / revenue;
  if (rate >= 1) return null;
  const fixed = sku.cogsKopecks - sku.columns.logistics - sku.columns.otherServices;
  return Math.max(Math.round(fixed / sku.units / (1 - rate)), 0);
}
