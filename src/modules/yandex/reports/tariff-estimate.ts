import type {
  IOfferLogistics,
  ITariffCalculation,
  ITariffOfferParams,
} from '../yandex-api.client';
import type { IOrderMoney, IOrderSubsidy } from './money';

import { orderTotals, subsidiesTotal } from './money';
import { SUBSIDY_TYPE } from './report-status-map';

/**
 * Оценка услуг Маркета по калькулятору тарифов — чистая арифметика.
 *
 * Модуль без I/O, как profit.ts: сервис приносит логистику каталога и ответы
 * калькулятора, здесь из них собирается сумма по набору заказов. Строка с ней
 * в отчёте «Прибыль» — ИНФОРМАЦИОННАЯ, для сверки с плоским процентом
 * комиссии; в вычитания и в чистую она не входит, арифметика profitOf её не
 * знает. Расчёт «примерный» по документации самого метода.
 *
 * Цена товара для калькулятора — цена позиции ПЛЮС субсидии Маркета на
 * единицу (промокоды, кешбэк; без DELIVERY — принцип subsidiesTotal). Реальная
 * комиссия берётся с цены с субсидией: рабочий пример продавца — 2689 × 23%,
 * где 2689 включает субсидию. Проверено на боевом за июль-2026: с субсидией
 * калькулятор даёт 23,9% от выручки, без — 20,0%.
 */

/**
 * Фолбэк габаритов, когда каталог их не отдал: часы, 11×11×11 см и 0,3 кг —
 * решение заказчика. Ноль или пропуск любого измерения отправлять нельзя
 * (`exclusiveMinimum: 0` — это 400, а не нулевой тариф). Проверено на боевом:
 * для часов фолбэк почти не влияет (среднее отклонение от реальных габаритов
 * 0 ₽, максимум 9 ₽ на товар).
 */
export const DEFAULT_DIMENSION_CM = 11;
export const DEFAULT_WEIGHT_KG = 0.3;

/** Позиция заказа в объёме, нужном оценке. Субсидии позиции — НА ЕДИНИЦУ. */
export interface ITariffEstimateItem {
  offerId?: string;
  count?: number;
  price?: number;
  subsidies?: readonly IOrderSubsidy[];
}

/** Заказ в объёме, нужном оценке. */
export interface ITariffEstimateOrder extends IOrderMoney {
  id?: number | string;
  items?: readonly ITariffEstimateItem[];
}

/** Итог оценки по одному набору заказов. */
export interface ITariffEstimate {
  /** По какому набору посчитано — тому же, чей блок печатает комиссию. */
  scope: 'placed' | 'redeemed';
  /** Сумма всех услуг калькулятора по ПОЛНОСТЬЮ покрытым заказам. */
  total: number;
  /** Та же сумма в разрезе услуг (FEE, DELIVERY_TO_CUSTOMER, …). */
  byService: Record<string, number>;
  /** Заказов, посчитанных целиком. Частично покрытый не считается вовсе. */
  coveredOrders: number;
  totalOrders: number;
  /**
   * Выручка покрытых заказов — знаменатель для «≈X%». Своим знаменателем, а
   * не выручкой всего набора: при частичном покрытии процент от общей выручки
   * занижался бы и сравнение с плоской комиссией теряло бы смысл.
   */
  coveredRevenue: number;
}

/** Одна строка запроса калькулятора: ключ (артикул, цена) + параметры. */
export interface ITariffRow {
  key: string;
  params: ITariffOfferParams;
}

/** Стоимость услуг за ЕДИНИЦУ товара по ключу строки. */
export interface ITariffUnitCost {
  total: number;
  byService: Record<string, number>;
}

/**
 * Цена позиции для калькулятора: цена + субсидии Маркета на единицу.
 *
 * DELIVERY исключается — это вознаграждение за доставку, тот же принцип, по
 * которому subsidiesTotal не считает его в «Продажи».
 */
export function tariffPriceOf(item: ITariffEstimateItem): number {
  const subsidies = (item.subsidies ?? []).reduce(
    (sum, s) => (s?.type === SUBSIDY_TYPE.DELIVERY ? sum : sum + (Number(s?.amount) || 0)),
    0,
  );
  return (Number(item.price) || 0) + subsidies;
}

/**
 * Ключ строки: артикул + цена. NUL как разделитель — единственный символ,
 * который не встретится в артикуле.
 */
function rowKeyOf(sku: string, price: number): string {
  return `${sku}\u0000${price}`;
}

/**
 * Строки запроса калькулятора по набору заказов: уникальные пары
 * (артикул, цена) с габаритами из каталога либо фолбэком.
 *
 * `uncoveredSkus` — артикулы, которые посчитать нельзя: их нет в каталоге или
 * у них нет категории. Габариты причиной не бывают — их закрывает фолбэк.
 */
export function buildTariffRows(
  orders: readonly ITariffEstimateOrder[],
  logistics: ReadonlyMap<string, IOfferLogistics>,
): { rows: ITariffRow[]; uncoveredSkus: string[] } {
  const rows = new Map<string, ITariffRow>();
  const uncovered = new Set<string>();

  for (const order of orders) {
    for (const item of order.items ?? []) {
      const sku = item.offerId;
      if (!sku) continue;

      const found = logistics.get(sku);
      const price = tariffPriceOf(item);
      if (!found?.marketCategoryId || price <= 0) {
        uncovered.add(sku);
        continue;
      }

      const key = rowKeyOf(sku, price);
      if (rows.has(key)) continue;

      const d = found.weightDimensions ?? {};
      const real =
        Number(d.length) > 0 &&
        Number(d.width) > 0 &&
        Number(d.height) > 0 &&
        Number(d.weight) > 0;

      rows.set(key, {
        key,
        params: {
          categoryId: found.marketCategoryId,
          price,
          length: real ? Number(d.length) : DEFAULT_DIMENSION_CM,
          width: real ? Number(d.width) : DEFAULT_DIMENSION_CM,
          height: real ? Number(d.height) : DEFAULT_DIMENSION_CM,
          weight: real ? Number(d.weight) : DEFAULT_WEIGHT_KG,
        },
      });
    }
  }

  return { rows: [...rows.values()], uncoveredSkus: [...uncovered] };
}

/**
 * Ответы калькулятора → стоимость услуг за единицу по ключу строки.
 *
 * Сопоставление ПО ИНДЕКСУ: порядок ответа равен порядку запроса — это
 * контракт метода, других идентификаторов в ответе нет. Суммируются ВСЕ
 * услуги, дубли типа — тоже (на боевом дублей не встречено, но правило
 * «сумма всего списка» не зависит от этого). Отсутствующий amount — ноль.
 */
export function unitCostsOf(
  rows: readonly ITariffRow[],
  calculations: readonly ITariffCalculation[],
): Map<string, ITariffUnitCost> {
  const out = new Map<string, ITariffUnitCost>();

  rows.forEach((row, index) => {
    const calc = calculations[index];
    if (!calc) return;

    const byService: Record<string, number> = {};
    let total = 0;
    for (const tariff of calc.tariffs) {
      const value = Number(tariff.amount) || 0;
      total += value;
      byService[tariff.type] = (byService[tariff.type] ?? 0) + value;
    }
    out.set(row.key, { total, byService });
  });

  return out;
}

/**
 * Свод по набору заказов: стоимость единицы × количество.
 *
 * Заказ, у которого не посчиталась хоть одна позиция, ИСКЛЮЧАЕТСЯ ЦЕЛИКОМ —
 * тот же принцип, по которому profitOf исключает заказ без закупочной цены:
 * частично посчитанный заказ дал бы сумму, которую не с чем сверить.
 */
export function estimateOf(
  orders: readonly ITariffEstimateOrder[],
  unitCosts: ReadonlyMap<string, ITariffUnitCost>,
  scope: ITariffEstimate['scope'],
): ITariffEstimate {
  let total = 0;
  let coveredOrders = 0;
  let coveredRevenue = 0;
  const byService: Record<string, number> = {};

  for (const order of orders) {
    const items = order.items ?? [];
    let orderTotal = 0;
    const orderByService: Record<string, number> = {};
    let covered = items.length > 0;

    for (const item of items) {
      const sku = item.offerId;
      const cost = sku ? unitCosts.get(rowKeyOf(sku, tariffPriceOf(item))) : undefined;
      if (!cost) {
        covered = false;
        break;
      }
      const count = Number(item.count) || 1;
      orderTotal += cost.total * count;
      for (const [type, value] of Object.entries(cost.byService)) {
        orderByService[type] = (orderByService[type] ?? 0) + value * count;
      }
    }

    if (!covered) continue;

    coveredOrders += 1;
    total += orderTotal;
    coveredRevenue += orderTotals(order).items + subsidiesTotal(order);
    for (const [type, value] of Object.entries(orderByService)) {
      byService[type] = (byService[type] ?? 0) + value;
    }
  }

  return { scope, total, byService, coveredOrders, totalOrders: orders.length, coveredRevenue };
}
