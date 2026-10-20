import type { TMarketplace } from '../../shared/marketplace';
import type { IDiscountConfig } from '../yandex/reports/profit';
import type { ICatalogOffer } from '../yandex/yandex-api.client';

import { discountedPurchase } from '../yandex/reports/profit';
import { skuCandidates } from '../yandex/stocks/sku-resolver';

/**
 * База товаров продавца — чистые правила, без Nest и Mongo.
 *
 * Товар (`Product`) — одна физическая модель, у которой может быть по карточке
 * на каждой площадке. Здесь три вещи: себестоимость товара, превращение
 * строк источников (прайс, каталог ЯМ) в строки для записи и сопоставление
 * карточек площадок с товарами (`matchCards`).
 */

/** Валюта, в которой цена уже в рублях. Так её называет Partner API. */
export const PRODUCT_BASE_CURRENCY = 'RUR';

/** Закуп товара, как он хранится: цена ДО скидки бренда. */
export interface IProductPurchase {
  /** Цена поставщика в валюте `currency` — как в прайсе, без скидки. */
  price: number;
  /** Нет поля — рубли. */
  currency?: string;
  /** Рублей за единицу валюты. Для рублей не нужен. */
  rate?: number;
  /** Доп. закупочные расходы на единицу (доставка, упаковка), в рублях. */
  extraCosts?: number;
}

/** Товар в объёме, нужном для себестоимости: бренд выводится из имени и категории. */
export interface IProductCostSource {
  name?: string;
  category?: string;
  purchase?: IProductPurchase | null;
}

/** Рубль ли это: пустая валюта — рубли, RUB — их ISO-код. */
function isBaseCurrency(currency: string | undefined): boolean {
  if (!currency) return true;
  const code = currency.trim().toUpperCase();
  return code === PRODUCT_BASE_CURRENCY || code === 'RUB';
}

/**
 * Себестоимость единицы товара в рублях:
 *
 *   закуп × курс − скидка бренда + доп. расходы
 *
 * Скидка бренда — `discountedPurchase` из profit.ts, та же функция, которой
 * считает «Прибыль»: вторая копия правила разошлась бы с ботом молча. Скидка
 * действует только на закуп у поставщика: доставку поставщик не дисконтирует.
 *
 * `null` — «неизвестна», а не ноль (довод `orderPurchase`): нет закупа, цена
 * не число, или валюта не рубли, а курса нет. Ноль сделал бы прибыль по такому
 * товару правдоподобной и ложной.
 */
export function productCost(product: IProductCostSource, config: IDiscountConfig): number | null {
  const purchase = product?.purchase;
  if (!purchase) return null;

  const price = Number(purchase.price);
  if (!Number.isFinite(price) || price < 0) return null;

  let rubles = price;
  if (!isBaseCurrency(purchase.currency)) {
    const rate = Number(purchase.rate);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    rubles = price * rate;
  }

  const discounted = discountedPurchase(
    { price: rubles, name: product.name, category: product.category },
    config,
  );

  const extra = Number(purchase.extraCosts);
  return discounted + (Number.isFinite(extra) && extra > 0 ? extra : 0);
}

/** Строка прайса для записи в товары: артикул уже разрешён по каталогу. */
export interface IProductPriceRow {
  sku: string;
  price: number;
  name?: string;
  category?: string;
}

/** Строка каталога площадки (ЯМ, Ozon) для записи в товары. */
export interface IProductCatalogRow {
  sku: string;
  name?: string;
  vendor?: string;
  vendorCode?: string;
  barcodes: string[];
  /** Цена продажи на площадке в рублях; нет — не задана или не в рублях. */
  salePrice?: number;
}

/**
 * Строки прайса → строки товаров. Без артикула и без цены строка отбрасывается;
 * повтор артикула в одной пачке схлопывается в последнюю строку — так же,
 * как его записал бы последовательный upsert.
 */
export function productRowsFromPriceList(
  rows: readonly { sku?: string; price?: number; name?: string; category?: string }[],
): IProductPriceRow[] {
  const bySku = new Map<string, IProductPriceRow>();
  for (const row of rows ?? []) {
    const sku = row?.sku?.trim();
    const price = Number(row?.price);
    if (!sku || !Number.isFinite(price) || price < 0) continue;
    bySku.set(sku, { sku, price, name: row.name, category: row.category });
  }
  return [...bySku.values()];
}

/** Остаток позиции прайса — «свой склад» товара (TASK-142). */
export interface IProductStockRow {
  sku: string;
  quantity: number;
}

/**
 * Строки прайса → остатки своего склада. Без артикула или с нечисловым
 * количеством строка отбрасывается; 0 — валидное «нет в наличии». Повтор
 * артикула — последняя строка, как у закупа.
 */
export function productStockRowsFromPriceList(
  rows: readonly { sku?: string; quantity?: number }[],
): IProductStockRow[] {
  const bySku = new Map<string, IProductStockRow>();
  for (const row of rows ?? []) {
    const sku = row?.sku?.trim();
    const quantity = Number(row?.quantity);
    if (!sku || !Number.isFinite(quantity) || quantity < 0) continue;
    bySku.set(sku, { sku, quantity: Math.floor(quantity) });
  }
  return [...bySku.values()];
}

/**
 * Товары каталога ЯМ → строки товаров. Цена продажи берётся только рублёвая:
 * курса для чужой валюты здесь нет, а «цена в долларах как рубли» — враньё.
 */
export function productRowsFromCatalog(offers: readonly ICatalogOffer[]): IProductCatalogRow[] {
  const bySku = new Map<string, IProductCatalogRow>();
  for (const offer of offers ?? []) {
    const sku = offer?.offerId?.trim();
    if (!sku) continue;
    bySku.set(sku, {
      sku,
      name: offer.name,
      vendor: offer.vendor,
      vendorCode: offer.vendorCode,
      barcodes: [...(offer.barcodes ?? [])],
      salePrice: isBaseCurrency(offer.currencyId) ? offer.basicPrice : undefined,
    });
  }
  return [...bySku.values()];
}

/** Карточка Ozon в объёме, нужном товарам (структурно — `IOzonProduct` клиента). */
export interface IOzonCatalogItem {
  offerId: string;
  name?: string;
  barcodes?: readonly string[];
  price?: number;
  currency?: string;
  archived?: boolean;
}

/** Строка каталога Ozon: та же строка товаров плюс признак архивной карточки. */
export interface IOzonCatalogRow extends IProductCatalogRow {
  archived?: boolean;
}

/**
 * Карточки Ozon → строки товаров (TASK-129). Артикул карточки — `offer_id`:
 * его задаёт продавец и его несут отправления (решение `ozon_card_key_offer_id`);
 * `product_id` и `sku` Ozon — его внутренние номера. Артикула производителя в
 * ответе нет, поэтому `vendor`/`vendorCode` пустые: уровень `vendorCode` у Ozon
 * не работает, остаются штрихкод и артикул. Цена — только рублёвая, довод
 * `productRowsFromCatalog`.
 */
export function ozonCatalogRows(items: readonly IOzonCatalogItem[]): IOzonCatalogRow[] {
  const bySku = new Map<string, IOzonCatalogRow>();
  for (const item of items ?? []) {
    const sku = item?.offerId?.trim();
    if (!sku) continue;
    const price = Number(item.price);
    bySku.set(sku, {
      sku,
      name: item.name || undefined,
      barcodes: (item.barcodes ?? []).map((code) => code?.trim()).filter((code) => !!code),
      salePrice:
        item.price !== undefined &&
        Number.isFinite(price) &&
        price > 0 &&
        isBaseCurrency(item.currency)
          ? price
          : undefined,
      // Только «да»: у живой карточки поля нет, и строка остаётся прежней.
      ...(item.archived ? { archived: true } : {}),
    });
  }
  return [...bySku.values()];
}

/** Карточка WB в том объёме, что нужен товарам (структурно — без импорта модуля wb). */
export interface IWbCatalogItem {
  vendorCode: string;
  title?: string;
  sizes?: readonly { barcodes?: readonly string[] }[];
}

/**
 * Карточки WB → строки товаров (TASK-134). Артикул — `vendorCode`, артикул
 * продавца: его задаёт продавец, как `offer_id` Ozon (довод
 * `ozon_card_key_offer_id`); `nmID` — внутренний номер WB. Штрихкоды — всех
 * размеров. Артикула производителя у WB нет, уровень `vendorCode` не работает.
 * Цены в карточке нет (она в категории «Цены и скидки»), поэтому `salePrice`
 * пуст и `salePrices.wb` не пишется. Повтор артикула — объединение штрихкодов.
 */
export function wbCatalogRows(items: readonly IWbCatalogItem[]): IProductCatalogRow[] {
  const bySku = new Map<string, IProductCatalogRow>();
  for (const item of items ?? []) {
    const sku = item?.vendorCode?.trim();
    if (!sku) continue;
    const row = bySku.get(sku) ?? { sku, name: undefined, barcodes: [] };
    row.name = item.title?.trim() || row.name;
    for (const size of item.sizes ?? []) {
      for (const raw of size?.barcodes ?? []) {
        const code = raw?.trim();
        if (code && !row.barcodes.includes(code)) row.barcodes.push(code);
      }
    }
    bySku.set(sku, row);
  }
  return [...bySku.values()];
}

// ─── Сопоставление карточек площадок с товарами (TASK-117) ───────────────────

// Площадки — общий лист `src/shared/marketplace.ts` (TASK-127): товары, подключения
// и CRM знают один список. Реэкспорт оставлен, чтобы модуль товаров не менял импорты.
export { isMarketplace, MARKETPLACES } from '../../shared/marketplace';
export type { TMarketplace } from '../../shared/marketplace';

/** Уровни автоматического сопоставления — по убыванию надёжности. */
export type TMatchLevel = 'barcode' | 'vendorCode' | 'sku';

export const MATCH_LEVELS: readonly TMatchLevel[] = ['barcode', 'vendorCode', 'sku'];

/**
 * Откуда у товара привязка к карточке: `seed` — товар заведён по самой
 * карточке (или строке прайса с её артикулом), уровень — автоматом,
 * `manual` — админ руками.
 */
export type TLinkSource = 'seed' | TMatchLevel | 'manual';

/** Почему карточка попала в очередь «не сопоставлено». */
export type TCardIssueReason =
  /** На одном уровне нашлось несколько товаров. */
  | 'conflict'
  /** Один и тот же товар в этом проходе требуют несколько карточек. */
  | 'shared'
  /** Пары нет, а завести товар нельзя: его внутренний SKU уже занят. */
  | 'sku_taken'
  /** Пары нет, а заводить товары на этой площадке не велено. */
  | 'no_match'
  /** Админ отвязал карточку руками — автомат её не трогает. */
  | 'manual_unlink';

export const CARD_ISSUE_LABEL: Record<TCardIssueReason, string> = {
  conflict: 'несколько товаров-кандидатов',
  shared: 'товар нужен нескольким карточкам',
  sku_taken: 'артикул уже занят другим товаром',
  no_match: 'пары нет',
  manual_unlink: 'отвязана вручную',
};

export const MATCH_LEVEL_LABEL: Record<TMatchLevel, string> = {
  barcode: 'штрихкод',
  vendorCode: 'артикул производителя',
  sku: 'артикул',
};

/** Карточка площадки в объёме, нужном сопоставлению. */
export interface IMarketplaceCard {
  sku: string;
  name?: string;
  vendorCode?: string;
  barcodes?: readonly string[];
}

/** Товар в объёме, нужном сопоставлению. */
export interface IMatchableProduct {
  id: string;
  internalSku: string;
  vendorCode?: string;
  barcodes?: readonly string[];
  marketplaceSkus?: Partial<Record<TMarketplace, string>>;
}

export type TCardMatch =
  /** Карточка уже привязана (автоматом или руками) — привязка не трогается. */
  | { kind: 'linked'; productId: string }
  /** Нашёлся ровно один свободный товар. */
  | { kind: 'matched'; productId: string; level: TMatchLevel }
  /** Пары нет — завести товар по карточке. */
  | { kind: 'create' }
  /** В очередь «не сопоставлено». */
  | {
      kind: 'issue';
      reason: Exclude<TCardIssueReason, 'manual_unlink'>;
      level?: TMatchLevel;
      candidateIds: string[];
    }
  /** Отвязана руками — проход её пропускает. */
  | { kind: 'skipped' };

export interface ICardMatchResult {
  card: IMarketplaceCard;
  match: TCardMatch;
}

export interface IMatchOptions {
  marketplace: TMarketplace;
  /** Артикулы карточек, отвязанных руками. */
  unlinked?: ReadonlySet<string>;
  /** Нет пары — завести товар (ЯМ, решение `product_match_ym_union`) или в очередь. */
  createMissing: boolean;
}

/** Штрихкод сравнивается как есть, без пробелов по краям; пустой — не штрихкод. */
function barcodeKey(value: string | undefined): string | null {
  const key = value?.trim();
  return key || null;
}

/** Артикул производителя — без пробелов по краям и без учёта регистра. */
function vendorCodeKey(value: string | undefined): string | null {
  const key = value?.trim().toUpperCase();
  return key || null;
}

function push(index: Map<string, Set<string>>, key: string | null, id: string): void {
  if (!key) return;
  const ids = index.get(key) ?? new Set<string>();
  ids.add(id);
  index.set(key, ids);
}

function collect(index: Map<string, Set<string>>, keys: readonly (string | null)[]): Set<string> {
  const found = new Set<string>();
  for (const key of keys) {
    if (!key) continue;
    for (const id of index.get(key) ?? []) found.add(id);
  }
  return found;
}

/**
 * Сопоставить карточки площадки с товарами продавца.
 *
 * Порядок: уже привязанная → отвязанная руками → штрихкод → артикул
 * производителя → артикул (`skuCandidates` от артикула и названия карточки,
 * против `internalSku`). Правила:
 *
 *  - **Привязка не трогается.** Карточка, чей артикул уже стоит у товара, —
 *    `linked`, кем бы привязка ни была поставлена; поэтому ручная привязка
 *    переживает любой следующий проход.
 *  - **Кандидат — только товар без привязки на этой площадке.** Иначе
 *    карточка уводила бы товар у другой карточки, а у товара на площадке
 *    оказалось бы две.
 *  - **Конфликт останавливает проход по уровням.** Два товара с одним
 *    штрихкодом — вопрос человеку; разрешить его артикулом значило бы молча
 *    выбрать одного из них слабым признаком.
 *  - **Один товар — одной карточке.** Если в проходе свободный товар нашли две
 *    карточки, в очередь уходят обе (`shared`): иначе исход зависел бы от
 *    порядка строк каталога.
 *  - Сравнение только точное (штрихкод — как есть, артикул производителя — без
 *    учёта регистра), без подстрок: ложная склейка хуже честной очереди.
 */
export function matchCards(
  cards: readonly IMarketplaceCard[],
  products: readonly IMatchableProduct[],
  options: IMatchOptions,
): ICardMatchResult[] {
  const { marketplace, unlinked, createMissing } = options;

  const linkedBySku = new Map<string, string>();
  const takenInternalSkus = new Map<string, string>();
  const byBarcode = new Map<string, Set<string>>();
  const byVendorCode = new Map<string, Set<string>>();
  const byInternalSku = new Map<string, Set<string>>();

  for (const product of products ?? []) {
    const linked = product.marketplaceSkus?.[marketplace];
    if (linked) {
      linkedBySku.set(linked, product.id);
      takenInternalSkus.set(product.internalSku, product.id);
      continue;
    }
    for (const barcode of product.barcodes ?? []) push(byBarcode, barcodeKey(barcode), product.id);
    push(byVendorCode, vendorCodeKey(product.vendorCode), product.id);
    push(byInternalSku, product.internalSku?.trim() || null, product.id);
  }

  const lookups: Record<TMatchLevel, (card: IMarketplaceCard) => Set<string>> = {
    barcode: (card) => collect(byBarcode, (card.barcodes ?? []).map(barcodeKey)),
    vendorCode: (card) => collect(byVendorCode, [vendorCodeKey(card.vendorCode)]),
    sku: (card) =>
      collect(byInternalSku, [
        ...skuCandidates(card.sku),
        ...(card.name?.trim() ? skuCandidates(card.name) : []),
      ]),
  };

  const bySku = new Map<string, IMarketplaceCard>();
  for (const card of cards ?? []) {
    const sku = card?.sku?.trim();
    if (sku) bySku.set(sku, { ...card, sku });
  }

  const results: ICardMatchResult[] = [];
  for (const card of bySku.values()) {
    results.push({ card, match: matchOne(card) });
  }

  // Один свободный товар — одной карточке: делёж уходит в очередь целиком.
  const claims = new Map<string, number>();
  for (const { match } of results) {
    if (match.kind === 'matched')
      claims.set(match.productId, (claims.get(match.productId) ?? 0) + 1);
  }
  for (const result of results) {
    const { match } = result;
    if (match.kind === 'matched' && (claims.get(match.productId) ?? 0) > 1) {
      result.match = {
        kind: 'issue',
        reason: 'shared',
        level: match.level,
        candidateIds: [match.productId],
      };
    }
  }

  return results;

  function matchOne(card: IMarketplaceCard): TCardMatch {
    const linked = linkedBySku.get(card.sku);
    if (linked) return { kind: 'linked', productId: linked };
    if (unlinked?.has(card.sku)) return { kind: 'skipped' };

    for (const level of MATCH_LEVELS) {
      const candidates = [...lookups[level](card)];
      if (candidates.length === 1) return { kind: 'matched', productId: candidates[0], level };
      if (candidates.length > 1) {
        return { kind: 'issue', reason: 'conflict', level, candidateIds: candidates.sort() };
      }
    }

    if (!createMissing) return { kind: 'issue', reason: 'no_match', candidateIds: [] };

    // Новый товар заводится с internalSku = артикул карточки. Занят товаром,
    // уже привязанным к другой карточке, — вставка упала бы на unique-индексе.
    const owner = takenInternalSkus.get(card.sku);
    if (owner) return { kind: 'issue', reason: 'sku_taken', candidateIds: [owner] };
    return { kind: 'create' };
  }
}

/** Сводка прохода — её печатает скрипт и отдаёт сервис. */
export interface IMatchSummary {
  cards: number;
  linked: number;
  matched: Record<TMatchLevel, number>;
  created: number;
  issues: Record<Exclude<TCardIssueReason, 'manual_unlink'>, number>;
  skipped: number;
  /** Доля карточек, у которых после прохода есть товар, в процентах (0 у пустого каталога). */
  boundPercent: number;
}

export function summarizeMatches(results: readonly ICardMatchResult[]): IMatchSummary {
  const summary: IMatchSummary = {
    cards: results.length,
    linked: 0,
    matched: { barcode: 0, vendorCode: 0, sku: 0 },
    created: 0,
    issues: { conflict: 0, shared: 0, sku_taken: 0, no_match: 0 },
    skipped: 0,
    boundPercent: 0,
  };

  for (const { match } of results) {
    if (match.kind === 'linked') summary.linked += 1;
    else if (match.kind === 'matched') summary.matched[match.level] += 1;
    else if (match.kind === 'create') summary.created += 1;
    else if (match.kind === 'issue') summary.issues[match.reason] += 1;
    else summary.skipped += 1;
  }

  const matched = MATCH_LEVELS.reduce((sum, level) => sum + summary.matched[level], 0);
  const bound = summary.linked + matched + summary.created;
  summary.boundPercent = results.length ? Math.round((bound / results.length) * 1000) / 10 : 0;
  return summary;
}
