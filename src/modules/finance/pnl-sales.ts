/**
 * Продажи периода по дням (TASK-140, ТЗ п.9, «Аналитика продаж»). Чистая
 * функция — её зовёт `pnlOf` на ТЕХ ЖЕ строках периода, что легли в корзины
 * статей, и на тех же штуках, что дали `pnl.units`. Поэтому Σ дней = итогу
 * периода по построению, а не сверкой двух расчётов (довод `byDay` «Прибыли»).
 *
 * - выручка дня — строки раздела «выручка» (продажи, возвраты, субсидии),
 *   начисленные в этот день;
 * - штуки дня — продано минус вернулось по строкам, двигающим товар (штуки
 *   строки берутся у себестоимости, `lineUnits`, а не пересчитываются);
 * - заказ относится к дню своей ПЕРВОЙ строки продажи в периоде: заказ с
 *   продажами в два дня посчитался бы дважды, и Σ дней разошлась бы с
 *   `ordersCount`.
 *
 * Пустые дни не заводятся: заполнение нулями — дело экрана, по границам периода.
 */

import type { TFinanceArticle } from './finance-articles';
import type { IPnlLine } from './pnl';

export interface IPnlSalesDay {
  /** ГГГГ-ММ-ДД по Москве — день начисления. */
  day: string;
  revenueKopecks: number;
  units: number;
  orders: number;
}

export interface IPnlSalesInput {
  /** Строки, начисленные в периоде. */
  accrued: readonly IPnlLine[];
  /** Штуки строки со знаком (продано «+», вернулось «−») — те же, что в `pnl.units`. */
  lineUnits: ReadonlyMap<string, number>;
  /** Статья — выручка? Передаётся из `pnl.ts`, чтобы лист не импортировал его в цикл. */
  isRevenue: (article: TFinanceArticle) => boolean;
}

/** Продажи по дням, по возрастанию дня. */
export function salesByDayOf(input: IPnlSalesInput): IPnlSalesDay[] {
  const days = new Map<string, IPnlSalesDay>();
  const firstSale = new Map<string, string>();
  const dayOf = (day: string): IPnlSalesDay => {
    let entry = days.get(day);
    if (!entry) {
      entry = { day, revenueKopecks: 0, units: 0, orders: 0 };
      days.set(day, entry);
    }
    return entry;
  };

  for (const line of input.accrued) {
    const revenue = input.isRevenue(line.article);
    // Только строка, двигающая товар: у операции с расшифровкой (Ozon,
    // TASK-131) части — строки с тем же id, и комиссия той же продажи иначе
    // принесла бы её штуки ещё раз.
    const units = line.goods ? input.lineUnits.get(line.id) : undefined;
    if (revenue) dayOf(line.accruedDay).revenueKopecks += line.amountKopecks;
    if (units !== undefined) dayOf(line.accruedDay).units += units;
    if (line.article === 'sales' && line.orderId) {
      const seen = firstSale.get(line.orderId);
      if (seen === undefined || line.accruedDay < seen)
        firstSale.set(line.orderId, line.accruedDay);
    }
  }
  for (const day of firstSale.values()) dayOf(day).orders += 1;

  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Штуки одного артикула за день (TASK-141). */
export interface IPnlSkuSalesDay {
  sku: string;
  /** ГГГГ-ММ-ДД по Москве — день начисления. */
  day: string;
  /** Продано минус вернулось. */
  units: number;
}

/**
 * Штуки по артикулам и дням (TASK-141, XYZ «Рейтингов»). Тот же проход и те же
 * штуки строк (`lineUnits`), что `pnl.units` и разрез `pnl.skus`, поэтому Σ
 * дней артикула = его `units` в разрезе по построению. Строки без артикула
 * сюда не идут — они в «не относится к товару». Порядок — артикул, затем день.
 */
export function skuSalesByDayOf(
  input: Pick<IPnlSalesInput, 'accrued' | 'lineUnits'>,
): IPnlSkuSalesDay[] {
  const cells = new Map<string, IPnlSkuSalesDay>();
  for (const line of input.accrued) {
    // Только строка, двигающая товар: у операции с расшифровкой (Ozon,
    // TASK-131) части — строки с тем же id, и комиссия той же продажи иначе
    // принесла бы её штуки ещё раз.
    const units = line.goods ? input.lineUnits.get(line.id) : undefined;
    if (!line.sku || units === undefined || units === 0) continue;
    const key = `${line.sku}\u0000${line.accruedDay}`;
    const cell = cells.get(key) ?? { sku: line.sku, day: line.accruedDay, units: 0 };
    cell.units += units;
    cells.set(key, cell);
  }
  return [...cells.values()].sort(
    (a, b) => a.sku.localeCompare(b.sku) || a.day.localeCompare(b.day),
  );
}
