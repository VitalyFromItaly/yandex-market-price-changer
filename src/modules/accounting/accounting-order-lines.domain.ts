import type { TReturnCondition } from './accounting-lots.domain';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IReturnRecord } from '../yandex/yandex-api.client';

import { createHash } from 'node:crypto';

import { orderDayIso } from '../yandex/reports/order-day';
import { SUBSIDY_TYPE, returnStage, ymOrderStage } from '../yandex/reports/report-status-map';

/**
 * Снимок строк заказов «Финучёта» (TASK-210, решение `accounting_order_lines_sync`):
 * строка на позицию заказа с ценой СДЕЛКИ — старые продажи считаются по ней, а не
 * по текущей цене карточки (ТЗ п.9, п.11). Здесь только чистые правила: сырой
 * заказ живого `GET /orders` → строки, отпечаток строки и окно опроса.
 */

/**
 * Источник строки: живой getOrders ЯМ (архив stats/orders без id позиции),
 * отправления Ozon с `financial_data`, orders/sales «Статистики» WB (TASK-211).
 */
export type TAccountingOrderLineSource = 'ym-orders' | 'ozon-postings' | 'wb-statistics';

/** Субсидия позиции: сумма НА ЕДИНИЦУ товара (довод `subsidiesTotal`, money.ts). */
interface IYmItemSubsidyRaw {
  type?: string;
  amount?: number;
}

interface IYmItemPromoRaw {
  /** Компенсация Маркета за единицу, проданную в рамках акции. */
  subsidy?: number;
}

/** Позиция живого OrderItemDTO — только поля, которые читает снимок. */
export interface IYmOrderItemRaw {
  id?: number | string;
  offerId?: string;
  offerName?: string;
  count?: number;
  /** Цена продавца за единицу без компенсации Маркета. */
  price?: number;
  /** Платёж покупателя за единицу после всех скидок. */
  buyerPrice?: number;
  buyerPriceBeforeDiscount?: number;
  subsidies?: readonly IYmItemSubsidyRaw[];
  promos?: readonly IYmItemPromoRaw[];
}

/** Заказ живого OrderDTO — только поля, которые читает снимок. */
export interface IYmOrderRaw {
  id?: number | string;
  status?: string;
  substatus?: string;
  creationDate?: string;
  updatedAt?: string;
  items?: readonly IYmOrderItemRaw[];
  delivery?: {
    dates?: { fromDate?: string; toDate?: string; realDeliveryDate?: string };
    shipments?: readonly { shipmentDate?: string }[];
  };
}

/**
 * Значимые поля строки — то, что версионируется. Деньги — целые копейки,
 * неизвестное — null, а не 0 (инвариант «Unknown cost is null»).
 */
export interface IAccountingOrderLineValue {
  /** Магазин ЯМ, из которого строка пришла (служебное, продавцу не показывается); у Ozon/WB — null. */
  campaignId: string | null;
  offerId: string | null;
  offerName: string | null;
  count: number;
  /** Цена продавца за единицу (`item.price`). */
  priceKopecks: number | null;
  /** Платёж покупателя за единицу (`item.buyerPrice`). */
  buyerPriceKopecks: number | null;
  buyerPriceBeforeDiscountKopecks: number | null;
  /**
   * Скидки и субсидии площадки за единицу: ЯМ — Σ `item.subsidies` без DELIVERY,
   * WB — СПП (`priceWithDisc − finishedPrice`), Ozon — `price − customer_price`.
   */
  marketplaceSubsidyKopecks: number | null;
  /**
   * Скидки продавца за единицу: (цена до скидок − платёж покупателя) − компенсация
   * Маркета по акциям (Σ `promos.subsidy`), не ниже 0. `promos.discount` Маркет
   * на живых заказах не присылает — по нему скидка выходила отрицательной.
   * Нет цены до скидок или платежа — null.
   */
  sellerDiscountKopecks: number | null;
  /**
   * Фактическая выручка позиции: (платёж покупателя + субсидии) × кол-во — та же
   * семантика «Продаж», что `orderTotals().sales`. Нет `buyerPrice` — null.
   */
  revenueKopecks: number | null;
  /**
   * К выплате продавцу за единицу: Ozon — `financial_data.payout`, WB — `forPay`
   * выкупа. У ЯМ в заказе нет — null (TASK-211; в отпечаток только не-null).
   */
  payoutKopecks?: number | null;
  /** Комиссия площадки за единицу: Ozon — `commission.amount`; ЯМ/WB — null. */
  commissionKopecks?: number | null;
  status: string | null;
  substatus: string | null;
  /** «ГГГГ-ММ-ДД», Москва. */
  createdOn: string | null;
  /** День выкупа: факт доставки, иначе день обновления выкупленного заказа. */
  soldOn: string | null;
  /** План доставки (верх интервала) или день отгрузки. */
  deliveryOn: string | null;
  /** День обновления вернувшегося заказа. */
  returnedOn: string | null;
  /**
   * Состояние возвращённого товара — вход FIFO режима Б (TASK-238): ЯМ — из
   * `instances` возвратов (`ymReturnConditions`); не возврат, Ozon/WB или нет
   * данных — null, FIFO читает его как `unknown` (в отпечаток только не-null).
   */
  returnCondition?: TReturnCondition | null;
  source: TAccountingOrderLineSource;
}

export interface IAccountingOrderLineInput extends IAccountingOrderLineValue {
  marketplace: TFinanceMarketplace;
  orderId: string;
  itemId: string;
}

/** Рубли → копейки. Мусор — null. */
export function kopecksOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function sumKopecks(values: readonly unknown[]): number {
  return values.reduce<number>((sum, value) => sum + (kopecksOf(value) ?? 0), 0);
}

function text(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || null;
}

/**
 * Логистические статусы экземпляра, после которых штука к продавцу не вернётся:
 * утеряна, утилизирована (или готовится к утилизации), отправлена Маркетом на
 * перепродажу. Для FIFO это `lost` — в партию не возвращается.
 */
const YM_LOST_INSTANCE_STATUSES: ReadonlySet<string> = new Set([
  'LOST',
  'UTILIZED',
  'PREPARED_FOR_UTILIZATION',
  'EXPROPRIATED',
]);
/** Типы остатка «ничего не известно» — `unknown`, а не брак. */
const YM_UNKNOWN_STOCK_TYPES: ReadonlySet<string> = new Set(['UNDEFINED', 'UNKNOWN']);

/**
 * Причины покупателя, при которых возврат считается браком (TASK-241, решение
 * `accounting_return_condition_ym_reason`): FBS-магазин `stockType` не присылает,
 * и это единственный признак брака. Это заявление покупателя, а не осмотр склада.
 */
const YM_DAMAGED_REASON_TYPES: ReadonlySet<string> = new Set([
  'BAD_QUALITY',
  'DAMAGE_DELIVERY',
  'WRONG_ITEM',
]);

/** Есть ли у позиции решение с бракующей причиной покупателя. */
export function ymReasonDamaged(
  decisions: readonly { reasonType?: string }[] | undefined,
): boolean {
  return (decisions ?? []).some((d) =>
    YM_DAMAGED_REASON_TYPES.has((d?.reasonType ?? '').toUpperCase()),
  );
}

/** Чем хуже, тем выше: позиция с несколькими экземплярами берёт худшее. */
const CONDITION_RANK: Record<TReturnCondition, number> = {
  fit: 0,
  unknown: 1,
  damaged: 2,
  lost: 3,
};

/** Экземпляр возврата ЯМ → состояние; отменённый экземпляр — null (не считается). */
export function ymInstanceCondition(instance: {
  stockType?: string;
  status?: string;
}): TReturnCondition | null {
  const status = (instance?.status ?? '').toUpperCase();
  if (status === 'CANCELLED') return null;
  if (YM_LOST_INSTANCE_STATUSES.has(status)) return 'lost';
  const stockType = (instance?.stockType ?? '').toUpperCase();
  if (stockType === 'FIT') return 'fit';
  if (!stockType || YM_UNKNOWN_STOCK_TYPES.has(stockType)) return 'unknown';
  return 'damaged';
}

/**
 * Состояния возвратов ЯМ: заказ → артикул → состояние (TASK-238). Мёртвая заявка
 * (`returnStage` = dead) не считается. Нет экземпляров — `unknown`. Несколько
 * экземпляров или возвратов одной позиции — худшее (lost > damaged > unknown >
 * fit): FIFO знает одно состояние на продажу, и осторожнее не вернуть брак в
 * партию, чем переоценить остаток (решение `accounting_return_condition_ym_mapping`).
 * Бракующая причина покупателя (`ymReasonDamaged`, TASK-241) поднимает `unknown`
 * до `damaged`; пришедший `stockType` и `lost` она не перебивает.
 */
export function ymReturnConditions(
  records: readonly IReturnRecord[],
): Map<string, Map<string, TReturnCondition>> {
  const result = new Map<string, Map<string, TReturnCondition>>();
  for (const record of records) {
    if (record?.orderId === undefined || record.orderId === null) continue;
    if (returnStage(record.shipmentStatus, record.refundStatus) === 'dead') continue;
    const orderId = String(record.orderId);
    for (const item of record.items ?? []) {
      const offerId = text(item?.offerId);
      if (!offerId) continue;
      const instances = item.instances ?? [];
      const reasonDamaged = ymReasonDamaged(item.decisions);
      const conditions = (
        instances.length
          ? instances.map(ymInstanceCondition).filter((c): c is TReturnCondition => c !== null)
          : ['unknown' as const]
      ).map((c): TReturnCondition => (c === 'unknown' && reasonDamaged ? 'damaged' : c));
      if (!conditions.length) continue;
      let byOffer = result.get(orderId);
      if (!byOffer) {
        byOffer = new Map();
        result.set(orderId, byOffer);
      }
      for (const condition of conditions) {
        const known = byOffer.get(offerId);
        if (!known || CONDITION_RANK[condition] > CONDITION_RANK[known]) {
          byOffer.set(offerId, condition);
        }
      }
    }
  }
  return result;
}

/**
 * Строки одного заказа. Позиция без id не пишется: ключ строки — id позиции.
 * `conditions` — состояния возвратов этого заказа по артикулу (`ymReturnConditions`);
 * ставятся только вернувшимся позициям.
 */
export function ymOrderLines(
  order: IYmOrderRaw,
  campaignId: string,
  conditions?: ReadonlyMap<string, TReturnCondition>,
): IAccountingOrderLineInput[] {
  const orderId = order?.id === undefined || order?.id === null ? '' : String(order.id);
  if (!orderId) return [];

  const stage = ymOrderStage({ status: order.status, substatus: order.substatus });
  const updatedOn = orderDayIso(order.updatedAt);
  const dates = order.delivery?.dates;
  const realDelivery = orderDayIso(dates?.realDeliveryDate);
  const soldOn = stage === 'redeemed' ? (realDelivery ?? updatedOn) : null;
  const deliveryOn =
    orderDayIso(dates?.toDate) ??
    orderDayIso(dates?.fromDate) ??
    orderDayIso(order.delivery?.shipments?.[0]?.shipmentDate);

  const lines: IAccountingOrderLineInput[] = [];
  for (const item of order.items ?? []) {
    const itemId = item?.id === undefined || item?.id === null ? '' : String(item.id);
    if (!itemId) continue;
    const count = Number.isFinite(Number(item.count)) ? Number(item.count) : 0;
    const buyerPriceKopecks = kopecksOf(item.buyerPrice);
    const marketplaceSubsidyKopecks = sumKopecks(
      (item.subsidies ?? [])
        .filter((subsidy) => subsidy?.type !== SUBSIDY_TYPE.DELIVERY)
        .map((subsidy) => subsidy?.amount),
    );
    const beforeKopecks = kopecksOf(item.buyerPriceBeforeDiscount);
    const promoSubsidyKopecks = sumKopecks((item.promos ?? []).map((promo) => promo?.subsidy));
    const sellerDiscountKopecks =
      beforeKopecks === null || buyerPriceKopecks === null
        ? null
        : Math.max(0, beforeKopecks - buyerPriceKopecks - promoSubsidyKopecks);
    lines.push({
      marketplace: 'ym',
      orderId,
      itemId,
      campaignId: String(campaignId),
      offerId: text(item.offerId),
      offerName: text(item.offerName),
      count,
      priceKopecks: kopecksOf(item.price),
      buyerPriceKopecks,
      buyerPriceBeforeDiscountKopecks: beforeKopecks,
      marketplaceSubsidyKopecks,
      sellerDiscountKopecks,
      revenueKopecks:
        buyerPriceKopecks === null ? null : (buyerPriceKopecks + marketplaceSubsidyKopecks) * count,
      status: text(order.status),
      substatus: text(order.substatus),
      createdOn: orderDayIso(order.creationDate),
      soldOn,
      deliveryOn,
      returnedOn: stage === 'returned' ? updatedOn : null,
      returnCondition:
        stage === 'returned' ? (conditions?.get(text(item.offerId) ?? '') ?? null) : null,
      source: 'ym-orders',
    });
  }
  return lines;
}

/** Деньги Ozon: с FBS v4 / FBO v3 — объект `{amount, currency}`, в `financial_data` — число. */
type TOzonMoneyRaw = number | string | { amount?: number | string; currency?: string } | null;

/** Товар отправления Ozon — только поля, которые читает снимок. */
export interface IOzonPostingProductRaw {
  sku?: number | string;
  offer_id?: string;
  name?: string;
  quantity?: number;
  price?: TOzonMoneyRaw;
}

/**
 * Товар `financial_data.products` — деньги на единицу. Форма сверена с живым
 * ответом FBS v4 (2026-11-08): `customer_price` и `commission` — объекты
 * `{amount, currency}`, `price`/`old_price`/`payout` — числа.
 */
export interface IOzonFinancialProductRaw {
  product_id?: number | string;
  /** Цена продавца после его скидок. */
  price?: TOzonMoneyRaw;
  /** Цена до скидок (зачёркнутая). */
  old_price?: TOzonMoneyRaw;
  /** Цена для покупателя после скидок за счёт Ozon. */
  customer_price?: TOzonMoneyRaw;
  /** 0, пока Ozon не посчитал (до доставки), — тогда null. */
  payout?: TOzonMoneyRaw;
  commission?: TOzonMoneyRaw;
  /** Прежнее имя комиссии — на случай схемы, где объекта `commission` нет. */
  commission_amount?: TOzonMoneyRaw;
}

/** Отправление Ozon (FBS v4 / FBO v3 с `with.financial_data`). */
export interface IOzonPostingRaw {
  posting_number?: string;
  status?: string;
  substatus?: string;
  in_process_at?: string;
  created_at?: string;
  shipment_date?: string;
  products?: readonly IOzonPostingProductRaw[];
  financial_data?: { products?: readonly IOzonFinancialProductRaw[] } | null;
}

function ozonKopecks(value: TOzonMoneyRaw | undefined): number | null {
  if (value && typeof value === 'object') return kopecksOf(value.amount);
  return kopecksOf(value);
}

/**
 * Выплата и комиссия Ozon: 0 у недоставленного отправления — «ещё не посчитано»
 * (живой ответ: `payout: 0`, `commission.amount: 0` у delivering), а не ноль
 * рублей; продажи без комиссии и выплаты не бывает — null.
 */
function ozonAccrued(value: TOzonMoneyRaw | undefined): number | null {
  const kopecks = ozonKopecks(value);
  return kopecks === 0 ? null : kopecks;
}

function differenceOf(high: number | null, low: number | null): number | null {
  return high === null || low === null ? null : Math.max(0, high - low);
}

function idText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * Строки отправления Ozon (TASK-211): строка на товар, ключ — (номер
 * отправления, sku). Цены раздельно (ТЗ п.7): цена покупателя
 * (`customer_price`), цена продавца (`financial_data.price`, иначе цена товара
 * отправления), к признанию дохода — цена продавца × кол-во (как
 * `commission.sale_amount` журнала, матрица), выплата и комиссия. Разница цены
 * продавца и цены покупателя — скидки за счёт Ozon (`actions` «за счёт Озон»),
 * то есть субсидия площадки, как СПП у WB. Даты выкупа и возврата в
 * отправлении нет — null (матрица), а не догадка.
 */
export function ozonOrderLines(posting: IOzonPostingRaw): IAccountingOrderLineInput[] {
  const orderId = text(posting?.posting_number);
  if (!orderId) return [];
  const financial = posting.financial_data?.products ?? [];
  const lines: IAccountingOrderLineInput[] = [];
  (posting.products ?? []).forEach((product, index) => {
    const itemId = idText(product?.sku);
    if (!itemId) return;
    const money =
      financial.find((entry) => idText(entry?.product_id) === itemId) ??
      (financial.length === (posting.products ?? []).length ? financial[index] : undefined);
    const count = Number.isFinite(Number(product.quantity)) ? Number(product.quantity) : 0;
    const priceKopecks = ozonKopecks(money?.price) ?? ozonKopecks(product.price);
    const oldKopecks = ozonKopecks(money?.old_price);
    const buyerPriceKopecks = ozonKopecks(money?.customer_price);
    lines.push({
      marketplace: 'ozon',
      orderId,
      itemId,
      campaignId: null,
      offerId: text(product.offer_id),
      offerName: text(product.name),
      count,
      priceKopecks,
      buyerPriceKopecks,
      buyerPriceBeforeDiscountKopecks: oldKopecks,
      marketplaceSubsidyKopecks: differenceOf(priceKopecks, buyerPriceKopecks),
      sellerDiscountKopecks: differenceOf(oldKopecks, priceKopecks),
      revenueKopecks: priceKopecks === null ? null : priceKopecks * count,
      payoutKopecks: ozonAccrued(money?.payout),
      commissionKopecks: ozonAccrued(money?.commission ?? money?.commission_amount),
      status: text(posting.status),
      substatus: text(posting.substatus),
      createdOn: orderDayIso(posting.in_process_at) ?? orderDayIso(posting.created_at),
      soldOn: null,
      deliveryOn: orderDayIso(posting.shipment_date),
      returnedOn: null,
      source: 'ozon-postings',
    });
  });
  return lines;
}

/** Строка supplier/orders «Статистики» WB — одна штука товара (`srid`). */
export interface IWbOrderRowRaw {
  srid?: string;
  date?: string;
  lastChangeDate?: string;
  supplierArticle?: string;
  nmId?: number | string;
  subject?: string;
  /** Цена до всех скидок. */
  totalPrice?: number;
  /** Цена продавца после его скидки, до СПП. */
  priceWithDisc?: number;
  /** Цена для покупателя после СПП. */
  finishedPrice?: number;
  isCancel?: boolean;
}

/** Строка supplier/sales: `saleID` S… — выкуп, R… — возврат. */
export interface IWbSaleRowRaw extends IWbOrderRowRaw {
  saleID?: string;
  /** К перечислению продавцу. */
  forPay?: number;
}

/** Цена WB: отрицательная у возвратов — берём модуль, мусор — null. */
function wbKopecks(value: unknown): number | null {
  const kopecks = kopecksOf(value);
  return kopecks === null ? null : Math.abs(kopecks);
}

/**
 * Строка штуки WB (TASK-211): заказ даёт цены и день оформления, продажа —
 * выкуп или возврат, его день и выплату. `previous` — сохранённая строка той
 * же штуки: продажа, пришедшая без заказа в окне, ложится поверх неё, а не
 * стирает цены заказа. Нет ни заказа, ни сохранённой строки — цены из продажи,
 * день оформления null. Ключ — `srid` (тот же номер, что `orderId` журнала WB).
 */
export function wbOrderLine(
  order: IWbOrderRowRaw | null,
  sale: IWbSaleRowRaw | null,
  previous: IAccountingOrderLineValue | null = null,
): IAccountingOrderLineInput | null {
  const source = order ?? sale;
  const orderId = text(source?.srid);
  if (!orderId) return null;
  const itemId = idText(order?.nmId ?? sale?.nmId) || orderId;
  const saleKind = text(sale?.saleID)?.charAt(0).toUpperCase() ?? null;

  const prices = order ?? (previous ? null : sale);
  const base: IAccountingOrderLineValue = prices
    ? (() => {
        const priceKopecks = wbKopecks(prices.priceWithDisc);
        const buyerPriceKopecks = wbKopecks(prices.finishedPrice);
        const totalKopecks = wbKopecks(prices.totalPrice);
        return {
          campaignId: null,
          offerId: text(prices.supplierArticle),
          offerName: text(prices.subject),
          count: 1,
          priceKopecks,
          buyerPriceKopecks,
          buyerPriceBeforeDiscountKopecks: totalKopecks,
          marketplaceSubsidyKopecks: differenceOf(priceKopecks, buyerPriceKopecks),
          sellerDiscountKopecks: differenceOf(totalKopecks, priceKopecks),
          revenueKopecks: priceKopecks,
          payoutKopecks: previous?.payoutKopecks ?? null,
          commissionKopecks: null,
          status: previous?.status ?? null,
          substatus: null,
          createdOn: order ? orderDayIso(order.date) : (previous?.createdOn ?? null),
          soldOn: previous?.soldOn ?? null,
          deliveryOn: null,
          returnedOn: previous?.returnedOn ?? null,
          source: 'wb-statistics',
        };
      })()
    : { ...lineValueOf(previous), source: 'wb-statistics' };

  let status = base.status;
  let { soldOn, returnedOn, payoutKopecks } = base;
  if (saleKind === 'S') {
    soldOn = orderDayIso(sale.date);
    payoutKopecks = wbKopecks(sale.forPay);
  } else if (saleKind === 'R') {
    returnedOn = orderDayIso(sale.date);
  }
  if (returnedOn) status = 'returned';
  else if (soldOn) status = 'sold';
  else if (order?.isCancel === true) status = 'cancelled';
  else if (order || !status) status = 'ordered';

  return {
    ...base,
    marketplace: 'wb',
    orderId,
    itemId,
    status,
    soldOn,
    returnedOn,
    payoutKopecks,
  };
}

/** Значимые поля строки (без ключа) — то, что лежит в версии. */
export function lineValueOf(line: IAccountingOrderLineValue): IAccountingOrderLineValue {
  return {
    campaignId: line.campaignId,
    offerId: line.offerId,
    offerName: line.offerName,
    count: line.count,
    priceKopecks: line.priceKopecks,
    buyerPriceKopecks: line.buyerPriceKopecks,
    buyerPriceBeforeDiscountKopecks: line.buyerPriceBeforeDiscountKopecks,
    marketplaceSubsidyKopecks: line.marketplaceSubsidyKopecks,
    sellerDiscountKopecks: line.sellerDiscountKopecks,
    revenueKopecks: line.revenueKopecks,
    payoutKopecks: line.payoutKopecks ?? null,
    commissionKopecks: line.commissionKopecks ?? null,
    status: line.status,
    substatus: line.substatus,
    createdOn: line.createdOn,
    soldOn: line.soldOn,
    deliveryOn: line.deliveryOn,
    returnedOn: line.returnedOn,
    returnCondition: line.returnCondition ?? null,
    source: line.source,
  };
}

/**
 * Поля, добавленные после первых строк (TASK-211, TASK-238): в отпечаток идут только
 * не-null. Иначе у каждой строки ЯМ, записанной до них, сменился бы отпечаток,
 * и следующий опрос написал бы всем лишнюю версию без единого изменения.
 */
const FINGERPRINT_OPTIONAL_KEYS: ReadonlySet<keyof IAccountingOrderLineValue> = new Set([
  'payoutKopecks',
  'commissionKopecks',
  'returnCondition',
] as const);

/**
 * Отпечаток строки: sha1 значимых полей в фиксированном порядке. Совпал —
 * новая версия не пишется (повторный опрос без изменений ничего не плодит).
 */
export function lineFingerprint(line: IAccountingOrderLineValue): string {
  const value = lineValueOf(line);
  const ordered = (Object.keys(value) as (keyof IAccountingOrderLineValue)[])
    .filter((key) => !FINGERPRINT_OPTIONAL_KEYS.has(key) || value[key] !== null)
    .sort()
    .map((key) => [key, value[key] ?? null]);
  return createHash('sha1').update(JSON.stringify(ordered)).digest('hex');
}

/** Первый опрос продавца берёт столько дней обновлений. */
export const ORDER_LINES_FIRST_DAYS = 7;
/** Нахлёст окна: заказ, обновлённый на границе прошлого опроса, не теряется. */
export const ORDER_LINES_OVERLAP_MS = 30 * 60 * 1000;
/** Предел живого getOrders — 30 дней назад (`HISTORY_WINDOW_DAYS`); берём с запасом. */
export const ORDER_LINES_MAX_DAYS = 29;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IOrderLinesWindow {
  from: Date;
  to: Date;
}

/**
 * Окно `updatedAt` опроса: первый раз — `firstDays` дней назад; дальше — от верха
 * окна последнего успеха с нахлёстом, но не старше предела API (продавец, у
 * которого опрос долго падал, догоняет последние 29 дней, а не получает 400).
 */
export function orderLinesWindow(
  cursorAt: Date | null,
  now: Date,
  firstDays: number = ORDER_LINES_FIRST_DAYS,
): IOrderLinesWindow {
  const floor = now.getTime() - ORDER_LINES_MAX_DAYS * DAY_MS;
  const wanted = cursorAt
    ? cursorAt.getTime() - ORDER_LINES_OVERLAP_MS
    : now.getTime() - Math.max(1, firstDays) * DAY_MS;
  return { from: new Date(Math.max(floor, Math.min(wanted, now.getTime()))), to: now };
}

/**
 * Окно отправлений Ozon: всегда последние `ORDER_LINES_MAX_DAYS` дней. Фильтр
 * Ozon — по началу обработки (`in_process_at`), а не по обновлению, поэтому
 * окно от курсора не увидело бы, как старое отправление доехало или отменилось.
 */
export function ozonOrderLinesWindow(now: Date): IOrderLinesWindow {
  return { from: new Date(now.getTime() - ORDER_LINES_MAX_DAYS * DAY_MS), to: now };
}

/**
 * Не чаще, чем раз в столько, на площадку. Опрос ставится раз в 15 минут под
 * ЯМ; проход WB стоит ≥ 2 × 61 с выдержки «Статистики» на токен (общей с
 * «Передачей остатков»), Ozon перечитывает 29 дней отправлений — им хватит часа.
 */
export const ORDER_LINES_MIN_INTERVAL_MS: Record<TFinanceMarketplace, number> = {
  ym: 0,
  ozon: 60 * 60 * 1000,
  wb: 60 * 60 * 1000,
};

/** Пора ли опрашивать площадку: прошлой попытки нет или она старше интервала. */
export function orderLinesDue(
  marketplace: TFinanceMarketplace,
  lastAttemptAt: Date | null,
  now: Date,
): boolean {
  if (!lastAttemptAt) return true;
  return now.getTime() - lastAttemptAt.getTime() >= ORDER_LINES_MIN_INTERVAL_MS[marketplace];
}

/** Итог опроса продавца: записано / без изменений / магазин не настроен / сбой. */
export type TAccountingOrdersSyncOutcome = 'imported' | 'unchanged' | 'not-connected' | 'failed';
