/**
 * История закупа v2 «Финучёта» (ТЗ п.2, режим А, TASK-213) — чистые правила, без
 * Nest и БД. Решения `accounting_cost_history_v2`, `accounting_unknown_cost_strict`.
 *
 * Чем отличается от текущей `CostHistory` (`products/cost-history.domain.ts`),
 * которая остаётся как была и кормит текущую «Прибыль»:
 *
 * - НАЧАЛО — момент (Date), а не московский день: две загрузки прайса за день —
 *   две записи, и продажа между ними получает закуп первой;
 * - СТРОГОСТЬ — записи до момента продажи нет → «Неизвестная закупка». Нет ни
 *   неявной стартовой (`current`), ни `validFrom: null` «с начала времён», ни
 *   отката на `PurchasePrice`/`Product.purchase`: такой откат и есть то, из-за
 *   чего прошлое молча пересчитывается новым прайсом;
 * - ИСПРАВЛЕНИЕ — задним числом, с причиной, в журнал было/стало; ничего не
 *   удаляется.
 *
 * Имя `accountingCostAt`, а не `costAt`: то занято текущей историей.
 *
 * Лист: чистые функции, импорты — листы.
 */

import type { ICostRecord } from '../products/cost-history.domain';
import type { IProductPurchase } from '../products/product.domain';
import type { IDiscountConfig } from '../yandex/reports/profit';

import { samePurchase } from '../products/cost-history.domain';
import { validateManualPurchase } from '../products/product-purchase.domain';
import { PRODUCT_BASE_CURRENCY, productCost } from '../products/product.domain';
import { moscowOffset } from '../yandex/reports/moscow-day';

/** Откуда запись: загрузка прайса, ручное исправление, перенос из `CostHistory`. */
export type TAccountingCostSource = 'price-list' | 'manual' | 'cost-history';

/** Что сделало исправление: завело запись на новый момент или переписало закуп существующей. */
export type TAccountingCostChangeAction = 'insert' | 'correct';

/** Подпись статуса для экранов нового учёта. */
export const UNKNOWN_COST_LABEL = 'Неизвестная закупка';

export const MAX_CORRECTION_REASON_LENGTH = 500;

/** Запись истории в объёме, нужном правилам. */
export interface IAccountingCostRecord {
  validFrom: Date;
  purchase: IProductPurchase;
  source: TAccountingCostSource;
  author?: string | null;
}

/** Значение записи в журнале исправлений: момент ISO и закуп. */
export interface IAccountingCostValue {
  validFrom: string;
  purchase: IProductPurchase;
}

/** Запись, которую добавляет загрузка прайса или перенос. */
export interface IAccountingCostWrite {
  productId: string;
  validFrom: Date;
  purchase: IProductPurchase;
  source: TAccountingCostSource;
}

export type TAccountingCostAt =
  | { status: 'known'; record: IAccountingCostRecord; purchase: IProductPurchase }
  | { status: 'unknown' };

function validMoment(moment: Date | null | undefined): moment is Date {
  return moment instanceof Date && !Number.isNaN(moment.getTime());
}

/**
 * Закуп, действующий в момент `moment`: последняя запись с `validFrom ≤ moment`.
 * Записи до момента нет, момент не задан или мусорный — `unknown`. Никакого
 * отката на текущий закуп (решение `accounting_unknown_cost_strict`).
 */
export function accountingCostAt(
  records: readonly IAccountingCostRecord[] | undefined,
  moment: Date | null | undefined,
): TAccountingCostAt {
  if (!validMoment(moment)) return { status: 'unknown' };
  const at = moment.getTime();
  let best: IAccountingCostRecord | null = null;
  for (const record of records ?? []) {
    const from = record?.validFrom?.getTime();
    if (from === undefined || Number.isNaN(from) || from > at) continue;
    if (!best || best.validFrom.getTime() < from) best = record;
  }
  return best ? { status: 'known', record: best, purchase: best.purchase } : { status: 'unknown' };
}

export type TAccountingUnitCost =
  | { status: 'known'; kopecks: number; record: IAccountingCostRecord }
  | { status: 'unknown'; reason: 'no-record' | 'unconvertible' };

/**
 * Себестоимость единицы на момент, в копейках. Та же `productCost`, что у текущей
 * «Прибыли» (скидка бренда, курс, доп. расходы), — формула одна, различается
 * только выбор записи. Валюта без курса — `unconvertible`, тоже «неизвестно».
 */
export function accountingUnitCost(
  product: { name?: string; category?: string },
  records: readonly IAccountingCostRecord[] | undefined,
  config: IDiscountConfig,
  moment: Date | null | undefined,
): TAccountingUnitCost {
  const at = accountingCostAt(records, moment);
  if (at.status === 'unknown') return { status: 'unknown', reason: 'no-record' };
  const rubles = productCost(
    { name: product?.name, category: product?.category, purchase: at.purchase },
    config,
  );
  if (rubles === null) return { status: 'unknown', reason: 'unconvertible' };
  return { status: 'known', kopecks: Math.round(rubles * 100), record: at.record };
}

/** Что нужно знать загрузке прайса о товарах, чтобы решить, что записать. */
export interface IAccountingCostWriteContext {
  /** Артикул → id товара (`ProductService.resolveForPriceList`). */
  productIds: ReadonlyMap<string, string>;
  /** Id товара → его записи v2. */
  records: ReadonlyMap<string, readonly IAccountingCostRecord[]>;
  /** Закуп из `PurchasePrice` ДО этой загрузки: файл не изменился → ручную запись не трогать. */
  previous: ReadonlyMap<string, { price: number }>;
}

/**
 * Записи v2 по загрузке прайса. ТОЛЬКО изменения: тот же прайс второй раз — ноль
 * записей; у товара нет ни одной записи — это тоже изменение (первая загрузка
 * после выкатки заводит записи всем товарам). Начало — момент загрузки.
 *
 * Как у текущей истории (решение `product_manual_vs_price_list`): прайс меняет
 * цену, доп. расходы действующей записи переносятся; действующая ручная запись
 * (в валюте) не переписывается файлом с той же ценой, что прошлый.
 */
export function priceListCostWrites(
  rows: readonly { sku: string; price: number }[],
  context: IAccountingCostWriteContext,
  now: Date,
): IAccountingCostWrite[] {
  const byProduct = new Map<string, IAccountingCostWrite>();
  for (const row of rows ?? []) {
    const productId = context.productIds.get(row.sku);
    if (!productId) continue;
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) continue;

    const next: IProductPurchase = { price, currency: PRODUCT_BASE_CURRENCY };
    const effective = accountingCostAt(context.records.get(productId), now);
    if (effective.status === 'known') {
      const previous = context.previous.get(row.sku);
      if (effective.record.source === 'manual' && previous && Number(previous.price) === price) {
        continue;
      }
      if (effective.purchase.extraCosts) next.extraCosts = effective.purchase.extraCosts;
      if (samePurchase(effective.purchase, next)) continue;
    }
    byProduct.set(productId, { productId, validFrom: now, purchase: next, source: 'price-list' });
  }
  return [...byProduct.values()];
}

/** Поле формы исправления, под которое фронт ставит ошибку. */
export type TCostCorrectionField =
  | 'validFrom'
  | 'price'
  | 'currency'
  | 'rate'
  | 'extraCosts'
  | 'reason';

export type TCostCorrectionValidation =
  | { ok: true; validFrom: Date; purchase: IProductPurchase; reason: string }
  | { ok: false; field: TCostCorrectionField; message: string };

/**
 * Проверка формы исправления: момент (ISO с временем) не в будущем — будущая цена
 * не «исправление прошлого», её задаёт прайс; закуп — те же правила, что ручная
 * правка «Товаров» (`validateManualPurchase`); причина обязательна.
 */
export function validateCostCorrection(
  input: Record<string, unknown>,
  now: Date,
): TCostCorrectionValidation {
  const raw = input?.validFrom;
  const validFrom = typeof raw === 'string' && raw.trim() ? new Date(raw.trim()) : null;
  if (!validMoment(validFrom)) {
    return { ok: false, field: 'validFrom', message: 'Укажите дату и время начала действия цены' };
  }
  if (validFrom.getTime() > now.getTime()) {
    return { ok: false, field: 'validFrom', message: 'Исправить можно только прошлую цену' };
  }

  const purchase = validateManualPurchase(input ?? {});
  if (purchase.ok === false) return purchase;

  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (!reason) return { ok: false, field: 'reason', message: 'Укажите причину исправления' };
  if (reason.length > MAX_CORRECTION_REASON_LENGTH) {
    return {
      ok: false,
      field: 'reason',
      message: `Причина — не длиннее ${MAX_CORRECTION_REASON_LENGTH} символов`,
    };
  }

  return { ok: true, validFrom, purchase: purchase.purchase, reason };
}

/**
 * Что сделает исправление: запись ровно на этот момент есть — переписать её закуп
 * (`correct`), совпадает — ничего (`noop`); нет — завести новую (`insert`).
 */
export function correctionKind(
  existing: IAccountingCostRecord | null,
  purchase: IProductPurchase,
): TAccountingCostChangeAction | 'noop' {
  if (!existing) return 'insert';
  return samePurchase(existing.purchase, purchase) ? 'noop' : 'correct';
}

export function costValueOf(record: {
  validFrom: Date;
  purchase: IProductPurchase;
}): IAccountingCostValue {
  return { validFrom: record.validFrom.toISOString(), purchase: record.purchase };
}

/** Начало московского дня `ГГГГ-ММ-ДД` как момент; мусор — null. */
export function moscowDayStartOf(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return null;
  const noon = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(noon.getTime()) || noon.toISOString().slice(0, 10) !== day) return null;
  return new Date(`${day}T00:00:00${moscowOffset(noon)}`);
}

/**
 * Перенос из текущей `CostHistory` (скрипт `backfill-accounting-cost-history`):
 * датированные записи → начало их московского дня. Стартовая (`validFrom: null`,
 * «с начала времён») НЕ переносится — строгость v2 (решение
 * `accounting_cost_history_v2`): продажи до первой известной цены — «Неизвестная
 * закупка».
 */
export function costHistoryCarryOver(
  productId: string,
  records: readonly ICostRecord[],
): IAccountingCostWrite[] {
  const writes: IAccountingCostWrite[] = [];
  for (const record of records ?? []) {
    if (record?.validFrom === null || record?.validFrom === undefined) continue;
    const validFrom = moscowDayStartOf(record.validFrom);
    const price = Number(record.price);
    if (!validFrom || !Number.isFinite(price)) continue;
    writes.push({
      productId,
      validFrom,
      purchase: carriedPurchase(record),
      source: 'cost-history',
    });
  }
  return writes;
}

/** Закуп записи `CostHistory` (поля лежат плоско) без пустых полей. */
function carriedPurchase(record: ICostRecord): IProductPurchase {
  const purchase: IProductPurchase = { price: Number(record.price) };
  if (record.currency) purchase.currency = record.currency;
  if (record.rate !== undefined && record.rate !== null) purchase.rate = record.rate;
  if (record.extraCosts !== undefined && record.extraCosts !== null) {
    purchase.extraCosts = record.extraCosts;
  }
  return purchase;
}
