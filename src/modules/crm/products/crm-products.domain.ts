import type { IUnmatchedCard } from '../../products/product-match.service';
import type { TMarketplace } from '../../products/product.domain';

import { PRODUCT_CURRENCIES } from '../../products/product-purchase.domain';

/**
 * Раздел «Товары» CRM (TASK-118): коды ответов и сборка вида. Правила — в
 * src/modules/products; здесь только перечисление полей наружу
 * (`telegramUserId` не уходит) и коды ошибок.
 */

/** 400: закуп не принят; `field` — под каким полем показать ошибку. */
export const INVALID_PURCHASE = 'INVALID_PURCHASE';
/** 400: площадка или артикул карточки не заданы. */
export const INVALID_LINK = 'INVALID_LINK';
/** 404: товара нет (или он чужой). */
export const PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND';

/** `kind` строки журнала о ручной правке закупа из CRM. */
export const PRODUCT_PURCHASE_KIND = 'product-purchase';

/** Валюты формы — фронт берёт список отсюда, а не держит копию. */
export const CRM_PRODUCT_CURRENCIES = PRODUCT_CURRENCIES;

export interface ICrmUnmatchedCard {
  marketplace: TMarketplace;
  sku: string;
  name: string | null;
  reason: string;
  reasonText: string;
  levelText: string | null;
  candidates: { productId: string; internalSku: string | null; name: string | null }[];
  detectedAt: Date;
}

/** Строка очереди для продавца — перечислением, без `telegramUserId`. */
export function toCrmUnmatched(item: IUnmatchedCard): ICrmUnmatchedCard {
  return {
    marketplace: item.marketplace,
    sku: item.sku,
    name: item.name,
    reason: item.reason,
    reasonText: item.reasonText,
    levelText: item.levelText,
    candidates: item.candidates.map((candidate) => ({
      productId: candidate.productId,
      internalSku: candidate.internalSku,
      name: candidate.name,
    })),
    detectedAt: item.detectedAt,
  };
}
