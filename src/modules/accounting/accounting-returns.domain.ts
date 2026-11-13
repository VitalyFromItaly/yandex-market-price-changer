/**
 * Раздел «Возвраты» «Финучёта» (TASK-225, ТЗ п.3). Чистые функции поверх
 * карточек заказов месяца оформления (`AccountingOrderCardService.periodOrders`):
 * результат каждого возвращённого заказа — `returnResultOf`, здесь только
 * суммы по площадке и частые модели. Своих статей нет.
 *
 * Площадки не складываются в одно число: на экране они колонками рядом.
 * Решение `accounting_returns_screen`.
 */

import type { IComputedOrder } from './accounting-order-card.service';
import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { IOrderExpenseShare } from './order-result';
import type { IReturnResult, TReturnResultKey } from './return-result';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';

import { MARKETPLACE_LABEL } from '../../shared/marketplace';

import { ORDER_EXPENSE_METHOD } from './expense-binding-allocation';
import { isCancelledOrderLine, isReturnedOrderLine } from './order-result';
import { returnResultOf } from './return-result';

/** Сколько моделей показывать в «чаще всего возвращают». */
export const RETURNS_TOP_MODELS = 10;

/** Обратная логистика в широком смысле: обратная доставка, обработка и хранение возврата. */
const REVERSE_KEYS: ReadonlySet<TReturnResultKey> = new Set([
  'reverse_logistics',
  'return_processing',
  'return_storage',
]);

export interface IAccountingReturnsMarketplace {
  marketplace: TFinanceMarketplace;
  label: string;
  /** Заказы месяца, ушедшие покупателю (отменённые до продажи не считаются). */
  ordersCount: number;
  returnedCount: number;
  /** Доля возвращённых заказов, 0…1; null — заказов нет. */
  returnRate: number | null;
  /** Σ выручки вернувшихся позиций; null — у позиции нет выручки. */
  returnedValueKopecks: number | null;
  /** Логистика до покупателя возвращённых заказов, со знаком журнала. */
  deliveryKopecks: number;
  /** Обратная логистика + обработка + хранение возврата. */
  reverseKopecks: number;
  /** Невозвращённая комиссия и эквайринг + удержания, штрафы, прочие услуги. */
  withheldKopecks: number;
  compensationsKopecks: number;
  /** Списание товара (режим Б); null — себестоимость неизвестна. */
  writeOffKopecks: number | null;
  repackingKopecks: number;
  /** Σ результатов возвращённых заказов; null — хоть у одного неизвестен. */
  resultKopecks: number | null;
  unknownCount: number;
}

export interface IAccountingReturnsModel {
  marketplace: TFinanceMarketplace;
  label: string;
  offerId: string;
  offerName: string | null;
  returnedUnits: number;
  soldUnits: number;
  /** Доля вернувшихся штук от ушедших покупателю, 0…1. */
  returnRate: number | null;
}

export interface IAccountingReturnsOrder {
  marketplace: TFinanceMarketplace;
  orderId: string;
  /** Названия вернувшихся моделей. */
  title: string;
  returnedOn: string | null;
  logisticsKopecks: number;
  resultKopecks: number | null;
}

export interface IAccountingReturnsSummary {
  marketplaces: IAccountingReturnsMarketplace[];
  models: IAccountingReturnsModel[];
  orders: IAccountingReturnsOrder[];
}

/** Повторная упаковка — расходы продавца со scope «заказ» из «Прочих расходов» карточки (TASK-220). */
export function repackingSharesOf(order: Pick<IComputedOrder, 'result'>): IOrderExpenseShare[] {
  const other = order.result.amounts.find((a) => a.key === 'other_expenses');
  return (other?.expenses ?? []).filter((e) => e.method === ORDER_EXPENSE_METHOD);
}

/** Результат возвращённого заказа — тем же входом, что карточка. */
export function returnOfOrder(order: IComputedOrder): IReturnResult {
  return returnResultOf({
    marketplace: order.marketplace,
    orderId: order.orderId,
    lines: order.lines,
    operations: order.operations,
    lotCostOf: order.lotCostOf,
    expenses: repackingSharesOf(order),
  });
}

const isShipped = (lines: readonly IAccountingOrderLineInput[]) =>
  lines.some((l) => !isCancelledOrderLine(l));

const rate = (part: number, whole: number) => (whole ? part / whole : null);

const amountOf = (result: IReturnResult, keys: ReadonlySet<TReturnResultKey>): number =>
  result.amounts.filter((a) => keys.has(a.key)).reduce((sum, a) => sum + (a.kopecks ?? 0), 0);

const one = (key: TReturnResultKey): ReadonlySet<TReturnResultKey> => new Set([key]);

function lastReturnedOn(lines: readonly IAccountingOrderLineInput[]): string | null {
  const days = lines
    .filter(isReturnedOrderLine)
    .map((l) => l.returnedOn)
    .filter(Boolean);
  return days.length ? days.sort().at(-1) : null;
}

/** Суммы раздела: площадки рядом, частые модели, возвращённые заказы. */
export function returnsSummaryOf(
  orders: readonly IComputedOrder[],
  marketplaces: readonly TFinanceMarketplace[],
): IAccountingReturnsSummary {
  const columns: IAccountingReturnsMarketplace[] = [];
  const modelsOf = new Map<string, IAccountingReturnsModel>();
  const returnedOrders: IAccountingReturnsOrder[] = [];

  for (const marketplace of marketplaces) {
    const own = orders.filter((o) => o.marketplace === marketplace && isShipped(o.lines));
    const column: IAccountingReturnsMarketplace = {
      marketplace,
      label: MARKETPLACE_LABEL[marketplace],
      ordersCount: own.length,
      returnedCount: 0,
      returnRate: null,
      returnedValueKopecks: 0,
      deliveryKopecks: 0,
      reverseKopecks: 0,
      withheldKopecks: 0,
      compensationsKopecks: 0,
      writeOffKopecks: 0,
      repackingKopecks: 0,
      resultKopecks: 0,
      unknownCount: 0,
    };

    for (const order of own) {
      for (const line of order.lines) {
        if (!line.offerId || isCancelledOrderLine(line)) continue;
        const key = `${marketplace}|${line.offerId}`;
        const model = modelsOf.get(key) ?? {
          marketplace,
          label: MARKETPLACE_LABEL[marketplace],
          offerId: line.offerId,
          offerName: line.offerName,
          returnedUnits: 0,
          soldUnits: 0,
          returnRate: null,
        };
        model.soldUnits += line.count;
        if (isReturnedOrderLine(line)) model.returnedUnits += line.count;
        if (!model.offerName && line.offerName) model.offerName = line.offerName;
        modelsOf.set(key, model);
      }

      if (!order.lines.some(isReturnedOrderLine)) continue;
      const result = returnOfOrder(order);
      column.returnedCount += 1;

      for (const line of order.lines.filter(isReturnedOrderLine)) {
        column.returnedValueKopecks =
          column.returnedValueKopecks === null || line.revenueKopecks === null
            ? null
            : column.returnedValueKopecks + line.revenueKopecks;
      }
      column.deliveryKopecks += amountOf(result, one('delivery'));
      column.reverseKopecks += amountOf(result, REVERSE_KEYS);
      column.withheldKopecks +=
        result.commission.netKopecks + result.acquiring.netKopecks + amountOf(result, one('other'));
      column.compensationsKopecks += amountOf(result, one('compensations'));
      column.repackingKopecks += amountOf(result, one('repacking'));
      const writeOff = result.amounts.find((a) => a.key === 'cogs_write_off');
      if (writeOff) {
        column.writeOffKopecks =
          column.writeOffKopecks === null || writeOff.kopecks === null
            ? null
            : column.writeOffKopecks + writeOff.kopecks;
      }
      if (result.resultKopecks === null) {
        column.unknownCount += 1;
        column.resultKopecks = null;
      } else if (column.resultKopecks !== null) {
        column.resultKopecks += result.resultKopecks;
      }

      returnedOrders.push({
        marketplace,
        orderId: order.orderId,
        title: [
          ...new Set(
            order.lines
              .filter(isReturnedOrderLine)
              .map((l) => l.offerName ?? l.offerId)
              .filter(Boolean),
          ),
        ].join(', '),
        returnedOn: lastReturnedOn(order.lines),
        logisticsKopecks: result.logisticsKopecks,
        resultKopecks: result.resultKopecks,
      });
    }
    column.returnRate = rate(column.returnedCount, column.ordersCount);
    columns.push(column);
  }

  const models = [...modelsOf.values()]
    .filter((m) => m.returnedUnits > 0)
    .map((m) => ({ ...m, returnRate: rate(m.returnedUnits, m.soldUnits) }))
    .sort((a, b) => b.returnedUnits - a.returnedUnits || a.offerId.localeCompare(b.offerId))
    .slice(0, RETURNS_TOP_MODELS);

  // Сначала самые убыточные; неизвестный результат — в конце.
  returnedOrders.sort(
    (a, b) =>
      (a.resultKopecks ?? Number.POSITIVE_INFINITY) - (b.resultKopecks ?? Number.POSITIVE_INFINITY),
  );

  return { marketplaces: columns, models, orders: returnedOrders };
}
