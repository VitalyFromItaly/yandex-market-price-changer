/**
 * Партии «Финучёта» — режим Б себестоимости, часть 1 (TASK-214, решения
 * `accounting_cost_modes`, `accounting_lots_storage`). Чистые функции — без Nest и базы.
 *
 * Партия — строка закупки (`finance_purchases.lines`) с количеством, остатком,
 * ценой за штуку и долей доставки от поставщика и прочих расходов закупки.
 * Списывает партии FIFO (TASK-215); текущая «Прибыль» и ДДС партий не видят.
 */

import type { IPurchaseLine } from '../finance/purchase.domain';

import { splitKopecks } from '../finance/pnl-sku';

/**
 * Как разнести доставку и прочие расходы закупки по строкам: `value` — по
 * стоимости строки (штуки × цена), `count` — по штукам.
 */
export const LOT_COST_SPLITS = ['value', 'count'] as const;
export type TLotCostSplit = (typeof LOT_COST_SPLITS)[number];
export const DEFAULT_LOT_COST_SPLIT: TLotCostSplit = 'value';

export const isLotCostSplit = (value: unknown): value is TLotCostSplit =>
  (LOT_COST_SPLITS as readonly unknown[]).includes(value);

/** То из закупки, что нужно для партий. */
export interface ILotsSource {
  paidDay: string;
  lines: readonly IPurchaseLine[] | null;
  deliveryKopecks: number;
  otherCostsKopecks: number;
  lotCostSplit: TLotCostSplit;
}

/** Партия до записи: закупку и продавца добавляет репозиторий. */
export interface ILotDraft {
  lineIndex: number;
  /** Товар Mongo строкой; null — артикул не сопоставлен (решение `accounting_lots_storage`). */
  productId: string | null;
  sku: string;
  name: string | null;
  count: number;
  remaining: number;
  unitPriceKopecks: number;
  /** Доля доставки и прочих расходов на ВСЮ строку — точно, без округления на штуку. */
  extraKopecks: number;
  /** «ГГГГ-ММ-ДД» — день поступления; отдельной даты у закупки нет, берётся день оплаты. */
  receivedDay: string;
}

/** Веса строк для `splitKopecks` по методике. */
function weightsOf(lines: readonly IPurchaseLine[], split: TLotCostSplit): number[] {
  return lines.map((line) => (split === 'count' ? line.count : line.count * line.priceKopecks));
}

/**
 * Доли доп. расходов по строкам: наибольший остаток, Σ долей = доставка + прочие
 * до копейки. Расходов нет — нули; `splitKopecks` при Σ весов ≤ 0 бросает, поэтому
 * без расходов и без положительных весов он не зовётся.
 */
export function extraShares(
  lines: readonly IPurchaseLine[],
  extraKopecks: number,
  split: TLotCostSplit,
): number[] {
  const weights = weightsOf(lines, split);
  if (extraKopecks === 0 || !(weights.reduce((sum, w) => sum + w, 0) > 0)) {
    return lines.map(() => 0);
  }
  return splitKopecks(extraKopecks, weights);
}

/**
 * Закупка → партии, по одной на строку, в порядке строк. Без строк — пусто:
 * закупка без позиций партий не порождает. Остаток новой партии = количество.
 */
export function lotsOfPurchase(
  purchase: ILotsSource,
  productIds: ReadonlyMap<string, string>,
): ILotDraft[] {
  const lines = purchase.lines ?? [];
  if (!lines.length) return [];
  const shares = extraShares(
    lines,
    purchase.deliveryKopecks + purchase.otherCostsKopecks,
    purchase.lotCostSplit,
  );
  return lines.map((line, index) => ({
    lineIndex: index,
    productId: productIds.get(line.sku) ?? null,
    sku: line.sku,
    name: line.name,
    count: line.count,
    remaining: line.count,
    unitPriceKopecks: line.priceKopecks,
    extraKopecks: shares[index],
    receivedDay: purchase.paidDay,
  }));
}

/**
 * Доля доп. расходов партии на `units` штук, если до них списано `consumedBefore`:
 * накопленное округление `round(k × extra / count)` разностью. Так любые порции
 * в сумме дают ровно `extraKopecks` партии, а одна и та же штука всегда стоит
 * одинаково — списание детерминировано (под FIFO TASK-215).
 */
export function extraForUnits(
  lot: Pick<ILotDraft, 'count' | 'extraKopecks'>,
  consumedBefore: number,
  units: number,
): number {
  if (!Number.isInteger(consumedBefore) || !Number.isInteger(units)) {
    throw new Error('extraForUnits: штуки — целые');
  }
  if (consumedBefore < 0 || units < 0 || consumedBefore + units > lot.count) {
    throw new Error('extraForUnits: штук больше, чем в партии');
  }
  const upTo = (k: number) => Math.round((k * lot.extraKopecks) / lot.count);
  return upTo(consumedBefore + units) - upTo(consumedBefore);
}

// ── Режим себестоимости и FIFO-списание (TASK-215) ──────────────────────────

/**
 * Режим себестоимости продавца (решения `accounting_cost_modes`,
 * `accounting_cost_mode_setting`): А — исторический закуп из прайса v2,
 * Б — партии закупок FIFO. По умолчанию А.
 */
export const ACCOUNTING_COST_METHODS = ['historical_price', 'lot_fifo'] as const;
export type TAccountingCostMethod = (typeof ACCOUNTING_COST_METHODS)[number];
export const DEFAULT_ACCOUNTING_COST_METHOD: TAccountingCostMethod = 'historical_price';

export const ACCOUNTING_COST_METHOD_TITLE: Record<TAccountingCostMethod, string> = {
  historical_price: 'Закуп из прайса на момент продажи',
  lot_fifo: 'Партии закупок (FIFO)',
};

export const isAccountingCostMethod = (value: unknown): value is TAccountingCostMethod =>
  (ACCOUNTING_COST_METHODS as readonly unknown[]).includes(value);

/** Как определена себестоимость заказа; `unknown` — не определена. */
export type TOrderCostMethod = TAccountingCostMethod | 'unknown';

/**
 * Состояние возвращённого товара: ЯМ — из `instances` возвратов (TASK-238,
 * `ymReturnConditions`); нет данных (Ozon/WB) — `unknown`, принимается
 * пригодным (решение `accounting_lots_return_condition`).
 */
export const RETURN_CONDITIONS = ['fit', 'damaged', 'lost', 'unknown'] as const;
export type TReturnCondition = (typeof RETURN_CONDITIONS)[number];

/** Возврат кладёт штуки обратно в партию: пригоден или состояние неизвестно. */
export const isRestoringReturn = (condition: TReturnCondition): boolean =>
  condition === 'fit' || condition === 'unknown';

/** Партия для FIFO — строка `accounting_lots` (остаток не нужен: считается с нуля). */
export interface IFifoLot {
  id: string;
  /** null — артикул не сопоставлен, FIFO партию не берёт. */
  productId: string | null;
  count: number;
  unitPriceKopecks: number;
  extraKopecks: number;
  receivedDay: string;
}

/** Продажа для FIFO — строка заказа с товаром. */
export interface IFifoSale {
  /** `площадка|заказ|позиция` — ключ результата. */
  key: string;
  productId: string | null;
  count: number;
  /** Момент продажи (`saleMomentOf`); null — нет дня оформления и выкупа. */
  moment: Date | null;
  returned: { moment: Date; condition: TReturnCondition } | null;
}

/** Сколько штук продажи взято из партии и во сколько. */
export interface ILotPortion {
  lotId: string;
  receivedDay: string;
  units: number;
  kopecks: number;
}

export type TLotSaleUnknownReason = 'no-product' | 'no-lot' | 'no-sale-moment';

/** Возврат продажи: восстановил партию или ушёл в списание. */
export interface ILotSaleReturn {
  condition: TReturnCondition;
  restored: boolean;
}

/**
 * Себестоимость продажи по партиям. `kopecks` — «+», Σ порций. Не хватило
 * партий — `no-lot` («Неизвестная закупка»): без отката на прайс.
 */
export type TLotSaleCost =
  | { status: 'known'; kopecks: number; portions: ILotPortion[]; returned: ILotSaleReturn | null }
  | { status: 'unknown'; reason: TLotSaleUnknownReason; returned: ILotSaleReturn | null };

/** Порция штук с их суммой — так восстановленные штуки сохраняют свою цену. */
interface IUnitsPortion {
  units: number;
  kopecks: number;
}

interface ILotState {
  lot: IFifoLot;
  /** Сколько свежих штук партии уже ушло (индекс для `extraForUnits`). */
  fresh: number;
  /** Восстановленные возвратом штуки — уходят первыми, по своей цене. */
  restored: IUnitsPortion[];
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** «ГГГГ-ММ-ДД» по Москве (UTC+3 без переходов). */
const moscowDayOf = (moment: Date): string =>
  new Date(moment.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);

/** Взять до `want` штук из партии: сначала восстановленные, потом свежие. */
function takeFrom(state: ILotState, want: number): IUnitsPortion {
  let units = 0;
  let kopecks = 0;
  while (units < want && state.restored.length) {
    const head = state.restored[0];
    const take = Math.min(head.units, want - units);
    // Доля порции — округлением от остатка: Σ взятого из порции = её сумма ровно.
    const part =
      take === head.units ? head.kopecks : Math.round((take * head.kopecks) / head.units);
    units += take;
    kopecks += part;
    if (take === head.units) state.restored.shift();
    else state.restored[0] = { units: head.units - take, kopecks: head.kopecks - part };
  }
  const fresh = Math.min(state.lot.count - state.fresh, want - units);
  if (fresh > 0) {
    kopecks += fresh * state.lot.unitPriceKopecks + extraForUnits(state.lot, state.fresh, fresh);
    state.fresh += fresh;
    units += fresh;
  }
  return { units, kopecks };
}

const available = (state: ILotState): number =>
  state.lot.count - state.fresh + state.restored.reduce((sum, p) => sum + p.units, 0);

/**
 * FIFO-списание с нуля по всем партиям и продажам продавца (решение
 * `accounting_lots_storage`: остаток в базе не истина). Детерминировано:
 * события упорядочены (момент, продажа раньше возврата, ключ) — порядок входа
 * продаж не влияет; партии — в порядке поступления (`listForUser`), ничья
 * дня — порядком входа.
 *
 * - продажа берёт штуки самых ранних партий своего товара, поступивших не
 *   позже дня продажи; восстановленные возвратом штуки партии — первыми;
 * - не хватило — доступное всё равно списывается (товар ушёл), продажа `no-lot`;
 * - возврат пригодного (или с неизвестным состоянием) кладёт взятые штуки
 *   обратно в их партии; повреждённый/утраченный — нет (списание).
 */
export function fifoAllocate(
  lots: readonly IFifoLot[],
  sales: readonly IFifoSale[],
): Map<string, TLotSaleCost> {
  return fifoAllocateWithRemaining(lots, sales).costs;
}

/** Итог FIFO: себестоимость продаж и остаток каждой партии после всех событий. */
export interface IFifoAllocation {
  costs: Map<string, TLotSaleCost>;
  /**
   * `lotId → штук в наличии` (свежие + восстановленные возвратом). Партия без
   * товара FIFO не берёт — её остаток = количество (TASK-216: экран партий).
   */
  remaining: Map<string, number>;
}

/** То же списание, что `fifoAllocate`, плюс остатки партий — одна формула на оба. */
export function fifoAllocateWithRemaining(
  lots: readonly IFifoLot[],
  sales: readonly IFifoSale[],
): IFifoAllocation {
  const states: ILotState[] = [];
  const byProduct = new Map<string, ILotState[]>();
  const ordered = lots
    .map((lot, index) => ({ lot, index }))
    .sort((a, b) => a.lot.receivedDay.localeCompare(b.lot.receivedDay) || a.index - b.index);
  for (const { lot } of ordered) {
    if (!lot.productId || lot.count <= 0) continue;
    const list = byProduct.get(lot.productId) ?? [];
    const state: ILotState = { lot, fresh: 0, restored: [] };
    states.push(state);
    list.push(state);
    byProduct.set(lot.productId, list);
  }

  const result = new Map<string, TLotSaleCost>();
  const taken = new Map<string, { state: ILotState; portion: IUnitsPortion }[]>();
  const events: { at: number; kind: 0 | 1; sale: IFifoSale }[] = [];

  for (const sale of sales) {
    const returned: ILotSaleReturn | null = sale.returned
      ? { condition: sale.returned.condition, restored: isRestoringReturn(sale.returned.condition) }
      : null;
    if (!sale.productId) {
      result.set(sale.key, { status: 'unknown', reason: 'no-product', returned });
      continue;
    }
    if (!sale.moment) {
      result.set(sale.key, { status: 'unknown', reason: 'no-sale-moment', returned });
      continue;
    }
    events.push({ at: sale.moment.getTime(), kind: 0, sale });
    if (sale.returned) {
      // Возврат не раньше продажи: без дня возврата (Ozon) — сразу после неё.
      const at = Math.max(sale.returned.moment.getTime(), sale.moment.getTime());
      events.push({ at, kind: 1, sale });
    }
  }
  events.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.kind !== b.kind) return a.kind - b.kind;
    if (a.sale.key === b.sale.key) return 0;
    return a.sale.key < b.sale.key ? -1 : 1;
  });

  for (const { kind, sale } of events) {
    const returned: ILotSaleReturn | null = sale.returned
      ? { condition: sale.returned.condition, restored: isRestoringReturn(sale.returned.condition) }
      : null;
    if (kind === 1) {
      if (returned?.restored) {
        for (const { state, portion } of taken.get(sale.key) ?? []) {
          state.restored.push({ ...portion });
        }
      }
      continue;
    }
    const day = moscowDayOf(sale.moment);
    const parts: { state: ILotState; portion: IUnitsPortion }[] = [];
    let need = sale.count;
    for (const state of byProduct.get(sale.productId) ?? []) {
      if (need <= 0) break;
      if (state.lot.receivedDay > day) break;
      if (!available(state)) continue;
      const portion = takeFrom(state, need);
      need -= portion.units;
      parts.push({ state, portion });
    }
    taken.set(sale.key, parts);
    result.set(
      sale.key,
      need > 0
        ? { status: 'unknown', reason: 'no-lot', returned }
        : {
            status: 'known',
            kopecks: parts.reduce((sum, p) => sum + p.portion.kopecks, 0),
            portions: parts.map(({ state, portion }) => ({
              lotId: state.lot.id,
              receivedDay: state.lot.receivedDay,
              units: portion.units,
              kopecks: portion.kopecks,
            })),
            returned,
          },
    );
  }
  const remaining = new Map<string, number>(lots.map((lot) => [lot.id, Math.max(lot.count, 0)]));
  for (const state of states) remaining.set(state.lot.id, available(state));
  return { costs: result, remaining };
}
