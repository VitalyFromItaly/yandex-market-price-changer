/**
 * «Аналитика возвратов» (TASK-145, ТЗ п.11) — возвраты периода одной площадки:
 * штуки и заказы, % от выкупов, сумма возвращённых товаров, обратная логистика,
 * удержания, компенсации, невозвращённые комиссии и потери. Чистая функция —
 * без Nest и базы; строки приносит `ReturnsAnalyticsService`.
 *
 * Правила (решения `returns_*` в tasks.json):
 * - всё — из журнала по дню НАЧИСЛЕНИЯ (`returns_from_journal`), не из отчётов
 *   заказов ЯМ: «Едет обратно» отвечает «что сейчас в пути», здесь — «во что
 *   обошлись возвраты периода», и деньги со штуками обязаны быть из одних строк;
 * - возврат и выкуп в штуках — по движению товара строки (`pnlLineOf().goods`)
 *   и штукам `cogsOf().lineUnits`: то же правило, что у себестоимости P&L. У ЯМ
 *   товар двигает только «Возврат платежа покупателя», строка возврата баллов —
 *   деньги без штук, поэтому возврат не считается дважды;
 * - невозвращённая комиссия — НЕТТО ПО ЗАКАЗУ за любые даты
 *   (`returns_unreturned_commission_net_by_order`): −Σ строк `commission`
 *   возвращённого заказа, удержанная при продаже минус возвращённая. Продажа
 *   прошлого месяца с возвратом в этом иначе дала бы «возвращённую» комиссию
 *   как доход;
 * - потери = обратная логистика + удержания + невозвращённая комиссия −
 *   компенсации — одна функция `returnLossesOf`;
 * - площадки не смешиваются: вход — строки одной площадки
 *   (`returns_marketplace_switch`).
 *
 * Деньги на входе — копейки со знаком площадки («+» продавцу, «−» удержание);
 * на выходе расходы — положительные «стоимости», компенсации — «+» продавцу.
 */

import type { IFinancePeriod } from './finance-period';
import type { IPnlLine, IPnlOperation } from './pnl';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IBrandSource, TBrandKey } from '../yandex/reports/brands';

import { BRAND_KEYS, brandOf, brandTitle } from '../yandex/reports/brands';

import { cogsOf, pnlLineOf } from './pnl';
import { OTHER_BRAND_TITLE } from './sales-analytics';

/** Показатели возвратов одной строки разреза. */
export interface IReturnFigures {
  /** Вернулось штук — строки, двигающие товар назад. */
  returnedUnits: number;
  /** Различных заказов со строкой возврата. */
  returnedOrders: number;
  /** Выкуплено штук в том же периоде — знаменатель %. */
  soldUnits: number;
  /** Вернулось / выкуплено; null — выкупов нет. Может быть > 1: возвращают и купленное раньше. */
  returnRate: number | null;
  /** Сумма возвращённых товаров (возврат платежа и баллов), копейки, > 0. */
  returnedAmountKopecks: number;
  /** Обратная логистика, копейки, > 0 — расход. */
  reverseLogisticsKopecks: number;
  /** Дополнительные удержания, копейки, > 0 — расход. */
  withholdingsKopecks: number;
  /** Компенсации площадки, копейки, > 0 — продавцу. */
  compensationsKopecks: number;
  /** Комиссия возвращённых заказов, которую площадка не вернула, копейки. */
  unreturnedCommissionKopecks: number;
  /** Потери — `returnLossesOf`. */
  lossesKopecks: number;
}

export interface IReturnSku extends IReturnFigures {
  sku: string;
  /** Название из базы товаров; null — товара в базе нет. */
  name: string | null;
  /** Бренд из реестра; null — «Остальные». */
  brand: TBrandKey | null;
}

export interface IReturnBrand extends IReturnFigures {
  key: TBrandKey | null;
  title: string;
  /** Товаров с возвратами или их расходами в периоде. */
  skus: number;
}

export interface IReturnsAnalytics {
  marketplace: TFinanceMarketplace;
  period: IFinancePeriod;
  totals: IReturnFigures;
  /** Товары с возвратами или их расходами, по потерям по убыванию. */
  skus: IReturnSku[];
  /** Бренды в порядке реестра, «Остальные» последними. */
  brands: IReturnBrand[];
  /**
   * Не отнесённое к товару: строки без артикула (сводные услуги, многотоварные
   * операции Ozon). Σ товаров + `rest` = итог.
   */
  rest: IReturnFigures;
}

/** Расходы, из которых складываются потери, — положительными «стоимостями». */
export interface IReturnLossParts {
  reverseLogisticsKopecks: number;
  withholdingsKopecks: number;
  unreturnedCommissionKopecks: number;
  compensationsKopecks: number;
}

/** Потери от возвратов: обр. логистика + удержания + невозвращённые комиссии − компенсации. */
export function returnLossesOf(parts: IReturnLossParts): number {
  return (
    parts.reverseLogisticsKopecks +
    parts.withholdingsKopecks +
    parts.unreturnedCommissionKopecks -
    parts.compensationsKopecks
  );
}

/** Строки, начисленные в периоде: `liveForPnl` отдаёт ещё оплаченные в нём строки налоговой базы. */
export function periodLinesOf(
  operations: readonly IPnlOperation[],
  period: IFinancePeriod,
): IPnlLine[] {
  return operations
    .map(pnlLineOf)
    .filter((line) => line.accruedDay >= period.from && line.accruedDay <= period.to);
}

/** Заказы со строкой возврата в периоде — их комиссия читается за все даты. */
export function returnedOrderIdsOf(lines: readonly IPnlLine[]): string[] {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.article === 'returns' && line.orderId) ids.add(line.orderId);
  }
  return [...ids];
}

interface IBucket {
  returnedUnits: number;
  orders: Set<string>;
  soldUnits: number;
  returnedAmount: number;
  reverseLogistics: number;
  withholdings: number;
  compensations: number;
  unreturnedCommission: number;
}

const emptyBucket = (): IBucket => ({
  returnedUnits: 0,
  orders: new Set(),
  soldUnits: 0,
  returnedAmount: 0,
  reverseLogistics: 0,
  withholdings: 0,
  compensations: 0,
  unreturnedCommission: 0,
});

function figuresOf(bucket: IBucket): IReturnFigures {
  const parts: IReturnLossParts = {
    reverseLogisticsKopecks: bucket.reverseLogistics,
    withholdingsKopecks: bucket.withholdings,
    unreturnedCommissionKopecks: bucket.unreturnedCommission,
    compensationsKopecks: bucket.compensations,
  };
  return {
    returnedUnits: bucket.returnedUnits,
    returnedOrders: bucket.orders.size,
    soldUnits: bucket.soldUnits,
    returnRate: bucket.soldUnits > 0 ? bucket.returnedUnits / bucket.soldUnits : null,
    returnedAmountKopecks: bucket.returnedAmount,
    ...parts,
    lossesKopecks: returnLossesOf(parts),
  };
}

function merge(target: IBucket, source: IBucket): void {
  target.returnedUnits += source.returnedUnits;
  for (const order of source.orders) target.orders.add(order);
  target.soldUnits += source.soldUnits;
  target.returnedAmount += source.returnedAmount;
  target.reverseLogistics += source.reverseLogistics;
  target.withholdings += source.withholdings;
  target.compensations += source.compensations;
  target.unreturnedCommission += source.unreturnedCommission;
}

/** Есть ли у товара что показывать в разделе возвратов — только продажи сюда не идут. */
function hasReturns(bucket: IBucket): boolean {
  return (
    bucket.returnedUnits !== 0 ||
    bucket.orders.size > 0 ||
    bucket.returnedAmount !== 0 ||
    bucket.reverseLogistics !== 0 ||
    bucket.withholdings !== 0 ||
    bucket.compensations !== 0 ||
    bucket.unreturnedCommission !== 0
  );
}

export interface IReturnsAnalyticsInput {
  marketplace: TFinanceMarketplace;
  period: IFinancePeriod;
  /** Строки площадки, начисленные в периоде (`periodLinesOf`). */
  lines: readonly IPnlLine[];
  /** Все живые строки возвращённых заказов за любые даты (`liveByOrderIds`). */
  orderOperations: readonly IPnlOperation[];
  /** Название и категория по артикулу журнала — для бренда. */
  products: ReadonlyMap<string, IBrandSource>;
}

/** Возвраты периода одной площадки: итог, товары, бренды, не отнесённое к товару. */
export function returnsAnalyticsOf(input: IReturnsAnalyticsInput): IReturnsAnalytics {
  const bySku = new Map<string, IBucket>();
  const rest = emptyBucket();
  const bucketOf = (sku: string | null): IBucket => {
    if (!sku) return rest;
    let bucket = bySku.get(sku);
    if (!bucket) {
      bucket = emptyBucket();
      bySku.set(sku, bucket);
    }
    return bucket;
  };

  // Штуки — правилом себестоимости, без своей формулы единиц; закуп тут не нужен.
  const { lineUnits } = cogsOf(input.lines, () => undefined);
  // Товар заказа — артикул его строки возврата: туда же ляжет его комиссия.
  const orderSku = new Map<string, string | null>();

  for (const line of input.lines) {
    const bucket = bucketOf(line.sku);
    const units = lineUnits.get(line.id) ?? 0;
    if (line.goods === 'sold') bucket.soldUnits += units;
    if (line.goods === 'returned') bucket.returnedUnits += -units;

    switch (line.article) {
      case 'returns':
        bucket.returnedAmount -= line.amountKopecks;
        if (line.orderId) {
          bucket.orders.add(line.orderId);
          if (!orderSku.get(line.orderId)) orderSku.set(line.orderId, line.sku);
        }
        break;
      case 'reverse_logistics':
        bucket.reverseLogistics -= line.amountKopecks;
        break;
      case 'withholdings':
        bucket.withholdings -= line.amountKopecks;
        break;
      case 'compensations':
        bucket.compensations += line.amountKopecks;
        break;
      default:
        break;
    }
  }

  for (const op of input.orderOperations) {
    if (op.article !== 'commission' || !op.orderId || !orderSku.has(op.orderId)) continue;
    bucketOf(orderSku.get(op.orderId) ?? null).unreturnedCommission -= op.amountKopecks;
  }

  const total = emptyBucket();
  merge(total, rest);
  const byBrand = new Map<TBrandKey | null, { bucket: IBucket; skus: number }>();
  const skus: IReturnSku[] = [];
  for (const [sku, bucket] of bySku) {
    merge(total, bucket);
    const product = input.products.get(sku);
    const brand = product ? brandOf(product) : null;
    const entry = byBrand.get(brand) ?? { bucket: emptyBucket(), skus: 0 };
    merge(entry.bucket, bucket);
    if (hasReturns(bucket)) {
      entry.skus += 1;
      skus.push({ sku, name: product?.name || null, brand, ...figuresOf(bucket) });
    }
    byBrand.set(brand, entry);
  }
  skus.sort(
    (a, b) =>
      b.lossesKopecks - a.lossesKopecks ||
      b.returnedUnits - a.returnedUnits ||
      a.sku.localeCompare(b.sku),
  );

  const brands: IReturnBrand[] = [...BRAND_KEYS, null]
    .filter((key) => byBrand.has(key) && hasReturns(byBrand.get(key)?.bucket ?? emptyBucket()))
    .map((key) => {
      const entry = byBrand.get(key) as { bucket: IBucket; skus: number };
      return {
        key,
        title: key ? brandTitle(key) : OTHER_BRAND_TITLE,
        skus: entry.skus,
        ...figuresOf(entry.bucket),
      };
    });

  return {
    marketplace: input.marketplace,
    period: { from: input.period.from, to: input.period.to },
    totals: figuresOf(total),
    skus,
    brands,
    rest: figuresOf(rest),
  };
}
