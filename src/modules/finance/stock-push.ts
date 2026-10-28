/**
 * «Передача остатков» (TASK-143) — сквозной FBS-остаток и план записи.
 *
 * Лист: ни Nest, ни Mongo, ни площадок. Вызывающий собирает товары, заказы и
 * текущие остатки площадок, а здесь решается, что и куда писать.
 *
 * Правило (решение `stock_push_formula_price_minus_sales`): физический остаток
 * своего склада = количество из последнего прайса минус штуки заказов со своего
 * склада (FBS/DBS/Экспресс) ВСЕХ площадок, оформленных с дня загрузки прайса.
 * Площадка сама уменьшает свой остаток при своём заказе, но не знает о чужих,
 * поэтому сквозной остаток пишется на каждую. FBY/FBO/FBW — склад площадки, его
 * продажи свой склад не трогают, и туда не пишется никогда (правило размещения).
 *
 * Всё неизвестное — запрет, а не ноль и не «пиши как есть»:
 * - заказы хоть одной площадки не прочитались — продажи неизвестны, план не
 *   пишет НИКУДА: остаток без чужих продаж завышен ровно на них;
 * - остатки площадки не прочитались — не пишется на неё: нечем проверить
 *   порог обнуления;
 * - товар не попал в последний прайс (его остаток с прошлого раза, TASK-142),
 *   прайс старше окна заказов или остатка нет вовсе — товар вне плана.
 */

import type { TMarketplace } from '../../shared/marketplace';
import type { TOrderStage } from '../../shared/order-stage';

import { createHash } from 'crypto';

import { isStockWritable } from '../yandex/stocks/placement';

/**
 * Больше стольких обнулений («было > 0, станет 0») за проход по площадке — ни
 * одной записи на неё и алерт (решение `stock_push_zeroing_threshold_5`).
 * Массовое обнуление — типовой след сломанного расчёта (прайс не того бренда,
 * заказы задвоились), а снятые с продажи товары продавец видит последним.
 */
export const STOCK_PUSH_MAX_ZEROED = 5;

/**
 * Насколько старым может быть прайс. Заказы читаются за последние 30 дней (у
 * Ozon/WB это окно `PERIOD.ALL`, у ЯМ — то, что держит Partner API); с запасом
 * на границы суток прайс старше этого вычесть продажи уже не даёт.
 */
export const STOCK_PUSH_ORDERS_WINDOW_DAYS = 28;

/** Схемы, где заказ собирается со склада продавца. Сравнение прописными. */
export const OWN_WAREHOUSE_SCHEMES: ReadonlySet<string> = new Set(['FBS', 'DBS', 'EXPRESS']);

/** Почему товар не попал в план. Тексты — `STOCK_PUSH_SKIP_TEXT`. */
export type TStockPushSkip = 'no-stock' | 'not-in-last-price-list' | 'price-list-too-old';

export const STOCK_PUSH_SKIP_TEXT: Readonly<Record<TStockPushSkip, string>> = {
  'no-stock': 'нет количества из прайса',
  'not-in-last-price-list': 'нет в последнем прайсе — остаток с прошлой загрузки, по нему не пишем',
  'price-list-too-old': `прайс старше ${STOCK_PUSH_ORDERS_WINDOW_DAYS} дней — продажи после него не прочитать`,
};

/**
 * Почему на площадку не пишется ничего. Порядок проверки — порядок этого
 * перечня: модель первой, потому что FBY не пишется НИ при каком раскладе.
 */
export type TStockPushBlock =
  | 'placement'
  | 'read-error'
  | 'orders-unknown'
  | 'zeroing'
  | 'no-warehouse'
  | 'several-warehouses'
  | 'no-write-method';

export const STOCK_PUSH_BLOCK_TEXT: Readonly<Record<TStockPushBlock, string>> = {
  placement: 'склад площадки (FBY/FBO/FBW или модель не определилась) — остатки сюда не пишутся',
  'read-error': 'текущие остатки площадки не прочитались — без них запись запрещена',
  'orders-unknown':
    'заказы одной из площадок не прочитались — продажи неизвестны, запись запрещена везде',
  zeroing: `обнулилось бы больше ${STOCK_PUSH_MAX_ZEROED} позиций — запись остановлена, проверьте прайс`,
  'no-warehouse': 'у продавца нет рабочего FBS-склада на этой площадке — писать некуда',
  'several-warehouses':
    'у продавца несколько складов на этой площадке — остаток из прайса не делится по складам, запись не идёт',
  'no-write-method': 'только просмотр: запись на эту площадку не открыта',
};

export interface IStockPushProduct {
  id: string;
  internalSku: string;
  name: string | null;
  /** Свой склад из прайса; null — прайс количества не давал. */
  stock: number | null;
  /** День загрузки прайса, давшей `stock`, `ГГГГ-ММ-ДД` по Москве. */
  stockDay: string | null;
  /** Артикул товара на каждой площадке. */
  skus: Partial<Record<TMarketplace, string>>;
}

export interface IStockPushOrder {
  scheme: string | null;
  stage: TOrderStage;
  /** День оформления `ГГГГ-ММ-ДД` по Москве; null — даты нет. */
  createdDay: string | null;
  items: readonly { sku: string; count: number }[];
}

/** Заказы одного источника (площадки или магазина ЯМ); `orders: null` — не прочитались. */
export interface IStockPushOrdersInput {
  marketplace: TMarketplace;
  source: string;
  /** Отменённые сюда не кладутся — их отдаёт площадка отдельным списком. */
  orders: readonly IStockPushOrder[] | null;
  error?: string;
}

/**
 * Куда писать: магазин ЯМ или площадка (Ozon/WB — место «склад продавца»; при
 * открытой записи ключ `<площадка>:<склад>` — единственный FBS-склад, TASK-175).
 */
export interface IStockPushTargetInput {
  marketplace: TMarketplace;
  /** Кампания ЯМ или ключ площадки — уникален в плане. */
  key: string;
  name: string;
  /** Модель размещения прописными; null — не определилась. */
  placement: string | null;
  /** Доступный остаток по артикулу на складе продавца; null — не прочитались. */
  available: Readonly<Record<string, number>> | null;
  error?: string;
  /**
   * Есть ли чем писать на площадку: у ЯМ — всегда, у Ozon и WB — метод записи
   * зарегистрирован (TASK-175). Фичу записи площадки проверяет запись, не план:
   * с закрытой фичей цель — тот же просмотр «что бы записали», что у ЯМ.
   */
  canWrite: boolean;
  /**
   * Артикулы, которые функция записи площадки не отправит, → причина (WB —
   * несколько размеров или нет штрихкода, решение `stock_push_wb_single_barcode`).
   * В план они не входят: иначе «Запишем N» и порог обнуления считали бы то,
   * что площадке не уйдёт.
   */
  unwritable?: Readonly<Record<string, string>>;
  /**
   * Склад записи Ozon/WB не однозначен (решение `stock_push_single_fbs_warehouse`):
   * FBS-склада нет или складов несколько — площадка не пишется.
   */
  warehouseBlock?: 'no-warehouse' | 'several-warehouses';
}

export interface IStockPushInput {
  products: readonly IStockPushProduct[];
  orders: readonly IStockPushOrdersInput[];
  targets: readonly IStockPushTargetInput[];
  /** Сегодня, `ГГГГ-ММ-ДД` по Москве. */
  today: string;
  /** Самый старый день прайса, по которому ещё читаются продажи. */
  oldestStockDay: string;
}

export interface IStockPushRow {
  productId: string;
  internalSku: string;
  name: string | null;
  sku: string;
  /** Сейчас на складе продавца на площадке. */
  from: number;
  to: number;
  /** Из прайса и продано после него — чтобы число «станет» можно было проверить. */
  priceListStock: number;
  sold: number;
}

export interface IStockPushTargetPlan {
  marketplace: TMarketplace;
  key: string;
  name: string;
  placement: string | null;
  blockedBy: TStockPushBlock | null;
  /** Строки, где «станет» отличается от «сейчас», — то, что уйдёт в запись. */
  updates: IStockPushRow[];
  /** Сколько из них обнуляют позицию с ненулевым остатком. */
  zeroed: number;
  /** Товаров площадки, где писать нечего: остаток уже такой. */
  unchanged: number;
  /**
   * Товаров с артикулом площадки, которого нет в её остатках на складе
   * продавца. Не пишутся: у ЯМ неизвестный кампании артикул отвергает весь
   * батч, а «поднять из ничего» — не то, ради чего функция существует.
   */
  notListed: number;
  /** Товаров, которые площадка не примет (`unwritable` цели), — не пишутся. */
  notWritable: number;
  error?: string;
}

export interface IStockPushSkipped {
  productId: string;
  internalSku: string;
  name: string | null;
  reason: TStockPushSkip;
}

export interface IStockPushPlan {
  /** Последний день загрузки прайса; null — прайса с количеством не было. */
  priceListDay: string | null;
  ordersKnown: boolean;
  orderErrors: { marketplace: TMarketplace; source: string; error: string }[];
  targets: IStockPushTargetPlan[];
  skipped: IStockPushSkipped[];
  /**
   * Отпечаток того, что будет записано (кампания, артикул, число). Запись
   * пересчитывает план и пишет только при совпадении — продавец подтверждал
   * именно эти числа (довод `splitByLive` карантина).
   */
  planHash: string;
}

export function stockPushPlanOf(input: IStockPushInput): IStockPushPlan {
  const priceListDay = latestDay(input.products);
  const orderErrors = input.orders
    .filter((source) => source.orders === null)
    .map((source) => ({
      marketplace: source.marketplace,
      source: source.source,
      error: source.error ?? 'нет ответа',
    }));
  const ordersKnown = orderErrors.length === 0;

  const eligible: IStockPushProduct[] = [];
  const skipped: IStockPushSkipped[] = [];
  for (const product of input.products) {
    const reason = skipReasonOf(product, priceListDay, input.oldestStockDay);
    if (reason) {
      skipped.push({
        productId: product.id,
        internalSku: product.internalSku,
        name: product.name,
        reason,
      });
    } else {
      eligible.push(product);
    }
  }

  const sold = soldByProduct(eligible, input.orders);
  const targets = input.targets.map((target) => targetPlanOf(target, eligible, sold, ordersKnown));

  return {
    priceListDay,
    ordersKnown,
    orderErrors,
    targets,
    skipped,
    planHash: planHashOf(targets),
  };
}

/** Отпечаток записываемого: только площадки без блокировки, в устойчивом порядке. */
export function planHashOf(targets: readonly IStockPushTargetPlan[]): string {
  const lines = targets
    .filter((target) => target.blockedBy === null)
    .flatMap((target) => target.updates.map((row) => `${target.key}\t${row.sku}\t${row.to}`))
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function latestDay(products: readonly IStockPushProduct[]): string | null {
  let latest: string | null = null;
  for (const product of products) {
    if (product.stock === null || !product.stockDay) continue;
    if (!latest || product.stockDay > latest) latest = product.stockDay;
  }
  return latest;
}

function skipReasonOf(
  product: IStockPushProduct,
  priceListDay: string | null,
  oldestStockDay: string,
): TStockPushSkip | null {
  if (product.stock === null || !Number.isFinite(product.stock) || !product.stockDay) {
    return 'no-stock';
  }
  if (priceListDay && product.stockDay < priceListDay) return 'not-in-last-price-list';
  if (product.stockDay < oldestStockDay) return 'price-list-too-old';
  return null;
}

/**
 * Продано со своего склада после прайса — по id товара. Заказ дня загрузки
 * вычитается: у заказа есть только день, и занизить остаток безопаснее, чем
 * завысить. Заказ без даты вычитается по той же причине.
 */
function soldByProduct(
  products: readonly IStockPushProduct[],
  sources: readonly IStockPushOrdersInput[],
): Map<string, number> {
  const bySku = new Map<TMarketplace, Map<string, IStockPushProduct>>();
  for (const product of products) {
    for (const [marketplace, sku] of Object.entries(product.skus) as [TMarketplace, string][]) {
      if (!sku) continue;
      const index = bySku.get(marketplace) ?? new Map<string, IStockPushProduct>();
      index.set(sku, product);
      bySku.set(marketplace, index);
    }
  }

  const sold = new Map<string, number>();
  for (const source of sources) {
    const index = bySku.get(source.marketplace);
    if (!index) continue;
    for (const order of source.orders ?? []) {
      if (order.stage === 'cancelled') continue;
      if (!order.scheme || !OWN_WAREHOUSE_SCHEMES.has(order.scheme.toUpperCase())) continue;
      for (const item of order.items) {
        const product = index.get(item.sku);
        const count = Number(item.count);
        if (!product || !(count > 0)) continue;
        if (order.createdDay && product.stockDay && order.createdDay < product.stockDay) continue;
        sold.set(product.id, (sold.get(product.id) ?? 0) + count);
      }
    }
  }
  return sold;
}

function targetPlanOf(
  target: IStockPushTargetInput,
  products: readonly IStockPushProduct[],
  sold: ReadonlyMap<string, number>,
  ordersKnown: boolean,
): IStockPushTargetPlan {
  const updates: IStockPushRow[] = [];
  let unchanged = 0;
  let notListed = 0;
  let notWritable = 0;

  for (const product of products) {
    const sku = product.skus[target.marketplace];
    if (!sku) continue;
    if (target.unwritable?.[sku]) {
      notWritable += 1;
      continue;
    }
    const productSold = sold.get(product.id) ?? 0;
    const stock = product.stock ?? 0;
    // Не выше физического по построению: вычитаемое неотрицательно.
    const to = Math.max(0, Math.floor(stock - productSold));
    const from = target.available ? target.available[sku] : undefined;
    if (typeof from !== 'number') {
      notListed += 1;
      continue;
    }
    if (from === to) {
      unchanged += 1;
      continue;
    }
    updates.push({
      productId: product.id,
      internalSku: product.internalSku,
      name: product.name,
      sku,
      from,
      to,
      priceListStock: stock,
      sold: productSold,
    });
  }
  updates.sort((a, b) => a.internalSku.localeCompare(b.internalSku));

  const zeroed = updates.filter((row) => row.to === 0 && row.from > 0).length;
  return {
    marketplace: target.marketplace,
    key: target.key,
    name: target.name,
    placement: target.placement,
    blockedBy: blockOf(target, ordersKnown, zeroed),
    updates,
    zeroed,
    unchanged,
    notListed,
    notWritable,
    ...(target.error ? { error: target.error } : {}),
  };
}

function blockOf(
  target: IStockPushTargetInput,
  ordersKnown: boolean,
  zeroed: number,
): TStockPushBlock | null {
  if (!target.placement || !isStockWritable(target.placement)) return 'placement';
  if (target.available === null) return 'read-error';
  if (!ordersKnown) return 'orders-unknown';
  if (zeroed > STOCK_PUSH_MAX_ZEROED) return 'zeroing';
  if (target.warehouseBlock) return target.warehouseBlock;
  if (!target.canWrite) return 'no-write-method';
  return null;
}
