/**
 * «Установка цен» (TASK-199) — план записи цен на площадки.
 *
 * Лист: ни Nest, ни Mongo, ни площадок. Вызывающий собирает товары, текущие
 * цены площадок и желаемые цены (наценка или файл), а здесь решается, что и
 * куда писать.
 *
 * Два способа (решение `price_set_two_modes`, 2026-10-28):
 * - наценка: цена = закуп из последнего прайса × % / 100 (250% → ×2,5), свой %
 *   на каждую площадку, площадки считаются независимо;
 * - файл «артикул | цена»: одна цена на все выбранные площадки.
 *
 * Цена — целые рубли (`Math.round`): WB принимает только целые, а одно правило
 * на все площадки не даёт ценам разъехаться на копейки. Зачёркнутая цена и
 * скидка не трогаются никогда: на WB пишется базовая цена, подобранная так,
 * чтобы с ТЕКУЩЕЙ скидкой вышла нужная (`wbBasePrice`).
 *
 * Неизвестное — не ноль: нет закупа — строка «без закупа», а не цена 0; нет
 * текущей цены — строка рискованная, сверить не с чем.
 */

import type { TMarketplace } from '../../shared/marketplace';

import { createHash } from 'crypto';

import { MARKETPLACES } from '../../shared/marketplace';

/**
 * Изменение больше этой доли (в любую сторону) — строка рискованная: в превью
 * подсвечена и по умолчанию снята. Типовой след ошибки — не тот процент, прайс
 * в другой валюте, лишний ноль в файле; а Маркет после резкого скачка сам
 * отправляет товар в карантин.
 */
export const PRICE_SET_RISKY_DELTA = 0.5;

/** Наценка в процентах от закупа — разумные границы, вне них опечатка. */
export const PRICE_SET_MARKUP_MIN = 1;
export const PRICE_SET_MARKUP_MAX = 10_000;

export type TPriceSetSource = 'markup' | 'file';

/** Почему товар не попал в план площадки. Тексты — `PRICE_SET_SKIP_TEXT`. */
export type TPriceSetSkip = 'no-purchase' | 'no-card' | 'bad-price' | 'duplicate';

export const PRICE_SET_SKIP_TEXT: Readonly<Record<TPriceSetSkip, string>> = {
  'no-purchase': 'нет закупочной цены в последнем прайсе',
  'no-card': 'товара нет на этой площадке',
  'bad-price': 'цена не разобралась или не больше нуля',
  duplicate: 'артикул повторяется в файле с разными ценами',
};

/** Почему на площадку не пишется ничего. Порядок проверки — порядок перечня. */
export type TPriceSetBlock = 'read-error' | 'no-markup' | 'no-write-method';

export const PRICE_SET_BLOCK_TEXT: Readonly<Record<TPriceSetBlock, string>> = {
  'read-error': 'текущие цены площадки не прочитались — без них запись запрещена',
  'no-markup': 'не задана наценка для этой площадки',
  'no-write-method': 'только просмотр: запись цен на эту площадку не открыта',
};

export interface IPriceSetProduct {
  /** Артикул продавца — тот, что в прайсе и в файле. */
  sku: string;
  name: string | null;
  /** Закуп из последнего прайса, ₽; null — неизвестен. */
  purchase: number | null;
  /** Артикул товара на каждой площадке. */
  skus: Partial<Record<TMarketplace, string>>;
}

/** Текущая цена товара на площадке. */
export interface IPriceSetCurrent {
  /** Цена, которую видит продавец в кабинете (для WB — базовая, до скидки), ₽; null — нет. */
  price: number | null;
  /** Скидка продавца, % — только WB. */
  discount?: number;
}

export interface IPriceSetTargetInput {
  marketplace: TMarketplace;
  /** Артикул площадки → текущая цена; null — не прочитались. */
  current: ReadonlyMap<string, IPriceSetCurrent> | null;
  /** Запись на площадку открыта (фича записи и способ записи есть). */
  writable: boolean;
}

/** Строка файла цен (после разбора `price-set-file.ts`). */
export interface IPriceSetFileRow {
  sku: string;
  price: number;
}

export type TPriceSetDesired =
  | { source: 'markup'; percents: Partial<Record<TMarketplace, number>> }
  | { source: 'file'; rows: readonly IPriceSetFileRow[] };

export interface IPriceSetPlanInput {
  products: readonly IPriceSetProduct[];
  desired: TPriceSetDesired;
  targets: readonly IPriceSetTargetInput[];
}

export interface IPriceSetUpdate {
  /** Артикул продавца. */
  sku: string;
  /** Артикул на площадке — ключ записи. */
  mpSku: string;
  name: string | null;
  /** Цена для покупателя сейчас, ₽; null — не знаем. */
  from: number | null;
  /** Цена для покупателя после записи, ₽. */
  to: number;
  /** Что уходит в API: на WB — базовая цена под текущую скидку, иначе `to`. */
  send: number;
  /** (to − from) / from; null — сравнить не с чем. */
  delta: number | null;
  risky: boolean;
}

export interface IPriceSetSkipped {
  sku: string;
  name: string | null;
  reason: TPriceSetSkip;
}

export interface IPriceSetTargetPlan {
  marketplace: TMarketplace;
  blockedBy: TPriceSetBlock | null;
  updates: IPriceSetUpdate[];
  /** Сколько товаров уже стоят по нужной цене. */
  unchanged: number;
  skipped: IPriceSetSkipped[];
}

export interface IPriceSetPlan {
  source: TPriceSetSource;
  targets: IPriceSetTargetPlan[];
  planHash: string;
}

/** Процент наценки из HTTP/формы — только число в границах. */
export function isMarkupPercent(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= PRICE_SET_MARKUP_MIN &&
    value <= PRICE_SET_MARKUP_MAX
  );
}

/** Цена от закупа: закуп × % / 100, до рубля. Нет закупа или вышел ноль — null, не 0. */
export function markupPrice(purchase: number | null, percent: number): number | null {
  if (purchase === null || !Number.isFinite(purchase) || purchase <= 0) return null;
  if (!isMarkupPercent(percent)) return null;
  const price = Math.round((purchase * percent) / 100);
  return price > 0 ? price : null;
}

/** Цена из файла → целые рубли; не число или ≤ 0 — null. */
export function wholePrice(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const price = Math.round(value);
  return price > 0 ? price : null;
}

/** Скидка WB, %: целое 0…99, всё прочее — 0 (скидки нет). */
function wbDiscount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return value > 0 && value < 100 ? value : 0;
}

/** Цена покупателя на WB из базовой и скидки — как её считает WB, до рубля. */
export function wbSalePrice(base: number, discount: number | undefined): number {
  return Math.round(base * (1 - wbDiscount(discount) / 100));
}

/** Базовая цена WB, при которой с текущей скидкой выйдет `target`. */
export function wbBasePrice(target: number, discount: number | undefined): number {
  return Math.round(target / (1 - wbDiscount(discount) / 100));
}

/** Ключ строки для выбора в превью и для apply: площадка + её артикул. */
export function priceSetRowKey(marketplace: TMarketplace, mpSku: string): string {
  return `${marketplace}:${mpSku}`;
}

/**
 * План записи. Площадки не зависят друг от друга: блокировка одной не трогает
 * остальные. Заблокированная площадка всё равно показывает свои строки —
 * продавец видит, что было бы записано (как «просмотр» у остатков).
 */
export function priceSetPlanOf(input: IPriceSetPlanInput): IPriceSetPlan {
  const fileRows = input.desired.source === 'file' ? fileDesired(input.desired.rows) : null;
  const targets = sortTargets(input.targets).map((target) =>
    targetPlanOf(input.products, input.desired, fileRows, target),
  );
  return { source: input.desired.source, targets, planHash: priceSetPlanHashOf(targets) };
}

/** Отпечаток записываемого: только площадки без блокировки, в устойчивом порядке. */
export function priceSetPlanHashOf(targets: readonly IPriceSetTargetPlan[]): string {
  const lines = targets
    .filter((target) => target.blockedBy === null)
    .flatMap((target) =>
      target.updates.map((row) => `${target.marketplace}\t${row.mpSku}\t${row.send}`),
    )
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** Цены файла по артикулу; повтор с другой ценой — артикул выпадает целиком. */
interface IFileDesired {
  prices: Map<string, number | null>;
  duplicates: Set<string>;
}

function fileDesired(rows: readonly IPriceSetFileRow[]): IFileDesired {
  const prices = new Map<string, number | null>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const price = wholePrice(row.price);
    if (prices.has(row.sku)) {
      if (prices.get(row.sku) !== price) duplicates.add(row.sku);
      continue;
    }
    prices.set(row.sku, price);
  }
  for (const sku of duplicates) prices.delete(sku);
  return { prices, duplicates };
}

function sortTargets(targets: readonly IPriceSetTargetInput[]): IPriceSetTargetInput[] {
  const order = (mp: TMarketplace) => MARKETPLACES.indexOf(mp);
  return [...targets].sort((a, b) => order(a.marketplace) - order(b.marketplace));
}

function targetPlanOf(
  products: readonly IPriceSetProduct[],
  desired: TPriceSetDesired,
  file: IFileDesired | null,
  target: IPriceSetTargetInput,
): IPriceSetTargetPlan {
  const mp = target.marketplace;
  const percent = desired.source === 'markup' ? desired.percents[mp] : undefined;
  const blockedBy = blockOf(target, desired.source === 'markup' && !isMarkupPercent(percent));
  const plan: IPriceSetTargetPlan = {
    marketplace: mp,
    blockedBy,
    updates: [],
    unchanged: 0,
    skipped: [],
  };
  if (blockedBy === 'read-error' || blockedBy === 'no-markup') return plan;
  const current = target.current;

  for (const item of itemsOf(products, desired, file, mp)) {
    if (item.skip) {
      plan.skipped.push({ sku: item.sku, name: item.name, reason: item.skip });
      continue;
    }
    const now = item.mpSku === null ? undefined : current.get(item.mpSku);
    if (now === undefined) {
      plan.skipped.push({ sku: item.sku, name: item.name, reason: 'no-card' });
      continue;
    }
    const to = item.price ?? markupPrice(item.purchase, percent);
    if (to === null) {
      plan.skipped.push({ sku: item.sku, name: item.name, reason: 'no-purchase' });
      continue;
    }
    const from = buyerPrice(mp, now);
    const send = mp === 'wb' ? wbBasePrice(to, now.discount) : to;
    if (from === to && (mp !== 'wb' || now.price === send)) {
      plan.unchanged++;
      continue;
    }
    const delta = from !== null && from > 0 ? (to - from) / from : null;
    plan.updates.push({
      sku: item.sku,
      mpSku: item.mpSku,
      name: item.name,
      from,
      to,
      send,
      delta,
      risky: delta === null || Math.abs(delta) > PRICE_SET_RISKY_DELTA,
    });
  }
  return plan;
}

function blockOf(target: IPriceSetTargetInput, noMarkup: boolean): TPriceSetBlock | null {
  if (target.current === null) return 'read-error';
  if (noMarkup) return 'no-markup';
  if (!target.writable) return 'no-write-method';
  return null;
}

/** Цена для покупателя сейчас: на WB — базовая со скидкой. */
function buyerPrice(mp: TMarketplace, now: IPriceSetCurrent): number | null {
  if (now.price === null) return null;
  return mp === 'wb' ? wbSalePrice(now.price, now.discount) : now.price;
}

interface IPlanItem {
  sku: string;
  name: string | null;
  mpSku: string | null;
  purchase: number | null;
  /** Цена из файла; null — считать наценкой. */
  price: number | null;
  skip: TPriceSetSkip | null;
}

/**
 * Что считать на площадке. Наценка — каждый товар с артикулом площадки. Файл —
 * каждая строка: артикул ищется у товара (артикул продавца или площадки), а без
 * товара берётся как артикул самой площадки — у продавца могут быть карточки,
 * которых нет в нашем справочнике.
 */
function itemsOf(
  products: readonly IPriceSetProduct[],
  desired: TPriceSetDesired,
  file: IFileDesired | null,
  mp: TMarketplace,
): IPlanItem[] {
  if (desired.source === 'markup') {
    return products.map((product) => ({
      sku: product.sku,
      name: product.name,
      mpSku: product.skus[mp] ?? null,
      purchase: product.purchase,
      price: null,
      skip: null,
    }));
  }
  const bySku = productIndex(products);
  const items: IPlanItem[] = [];
  for (const [sku, price] of file.prices) {
    const product = bySku.get(sku);
    items.push({
      sku,
      name: product?.name ?? null,
      mpSku: product ? (product.skus[mp] ?? null) : sku,
      purchase: null,
      price,
      skip: price === null ? 'bad-price' : null,
    });
  }
  for (const sku of file.duplicates) {
    items.push({
      sku,
      name: bySku.get(sku)?.name ?? null,
      mpSku: null,
      purchase: null,
      price: null,
      skip: 'duplicate',
    });
  }
  return items;
}

/** Артикул продавца и артикулы площадок → товар; артикул продавца в приоритете. */
function productIndex(products: readonly IPriceSetProduct[]): Map<string, IPriceSetProduct> {
  const index = new Map<string, IPriceSetProduct>();
  for (const product of products) {
    for (const sku of Object.values(product.skus)) {
      if (sku && !index.has(sku)) index.set(sku, product);
    }
  }
  for (const product of products) index.set(product.sku, product);
  return index;
}

/**
 * Артикулы площадки, чьи текущие цены нужны плану: ровно те, что `priceSetPlanOf`
 * станет искать в `current`, — правило одно, не две копии сопоставления.
 */
export function priceSetSkusOf(
  products: readonly IPriceSetProduct[],
  desired: TPriceSetDesired,
  mp: TMarketplace,
): string[] {
  const file = desired.source === 'file' ? fileDesired(desired.rows) : null;
  const skus = new Set<string>();
  for (const item of itemsOf(products, desired, file, mp)) {
    if (!item.skip && item.mpSku !== null) skus.add(item.mpSku);
  }
  return [...skus];
}

/**
 * Что продавец просил посчитать — хранится в результате плана и по нему `apply`
 * пересчитывает план: файл после разбора больше не нужен, а отпечаток сверяется
 * с тем же запросом, что видел продавец.
 */
export interface IPriceSetRequest {
  desired: TPriceSetDesired;
  marketplaces: TMarketplace[];
}

/** Запрос из хранилища/HTTP — только целой формы, иначе null. */
export function priceSetRequestOf(value: unknown): IPriceSetRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { desired, marketplaces } = value as { desired?: unknown; marketplaces?: unknown };
  if (!Array.isArray(marketplaces) || !marketplaces.every(isMarketplaceKey)) return null;
  const parsed = desiredOf(desired);
  return parsed ? { desired: parsed, marketplaces: [...new Set(marketplaces)] } : null;
}

function isMarketplaceKey(value: unknown): value is TMarketplace {
  return typeof value === 'string' && (MARKETPLACES as readonly string[]).includes(value);
}

function desiredOf(value: unknown): TPriceSetDesired | null {
  if (!value || typeof value !== 'object') return null;
  const desired = value as { source?: unknown; percents?: unknown; rows?: unknown };
  if (desired.source === 'markup') {
    if (!desired.percents || typeof desired.percents !== 'object') return null;
    const percents: Partial<Record<TMarketplace, number>> = {};
    for (const [mp, percent] of Object.entries(desired.percents)) {
      if (!isMarketplaceKey(mp) || !isMarkupPercent(percent)) return null;
      percents[mp] = percent;
    }
    return { source: 'markup', percents };
  }
  if (desired.source === 'file') {
    if (!Array.isArray(desired.rows)) return null;
    const rows: IPriceSetFileRow[] = [];
    for (const row of desired.rows as unknown[]) {
      const { sku, price } = (row ?? {}) as { sku?: unknown; price?: unknown };
      if (typeof sku !== 'string' || !sku || typeof price !== 'number') return null;
      rows.push({ sku, price });
    }
    return { source: 'file', rows };
  }
  return null;
}
