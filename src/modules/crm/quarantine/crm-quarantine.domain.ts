import type { IQuarantineOffer } from '../../yandex/quarantine/quarantine.domain';

import {
  QUARANTINE_EXPLAINER,
  quarantineBusinessNote,
  verdictTitle,
} from '../../yandex/quarantine/quarantine-message';

/**
 * Карантин цен в CRM: форма ответа, разбор тела подтверждения, коды ошибок.
 * Чистый модуль (паттерн crm-price-list.domain).
 */

/** 400: список артикулов пуст или битый. */
export const INVALID_OFFERS = 'INVALID_OFFERS';
export const INVALID_OFFERS_TEXT = 'Не выбрано ни одного товара для подтверждения.';
/** 502: часть батчей подтверждена, дальше Маркет отказал; в ответе `confirmed`/`requested`. */
export const QUARANTINE_PARTIAL = 'QUARANTINE_PARTIAL';
/** 502: Маркет отказал или недоступен; `message` — его `userMessage`. */
export const MARKET_ERROR = 'MARKET_ERROR';

/** Потолок длины артикула — ShopSku в спеке до 255 символов. */
const OFFER_ID_MAX = 255;

export interface ICrmQuarantineVerdict {
  type: string;
  title: string;
  /** null, а не 0: цены нет в ответе — это «неизвестно», не «бесплатно». */
  currentPrice: number | null;
  /** Есть только у PRICE_CHANGE. */
  lastValidPrice: number | null;
  /** Порог LOW_PRICE / LOW_PRICE_PROMO. */
  minPrice: number | null;
}

export interface ICrmQuarantineOffer {
  offerId: string;
  verdicts: ICrmQuarantineVerdict[];
}

export interface ICrmQuarantineView {
  /** Имя кабинета: карантин общий на все его магазины. */
  businessName: string;
  /** Что такое карантин — те же строки, что под шапкой экрана бота. */
  explainer: string[];
  /** «Список общий для всех магазинов кабинета…» — раздел живёт в магазине, а охват шире. */
  note: string;
  offers: ICrmQuarantineOffer[];
}

export interface ICrmQuarantineConfirmed {
  confirmed: number;
  /** Артикулы из запроса, которых в карантине уже нет (веб показал устаревший список). */
  stale: number;
}

/** Ответ перечислением полей — довод `/auth/me`: ничего лишнего из ответа Маркета. */
export function toCrmQuarantineView(
  businessName: string,
  offers: readonly IQuarantineOffer[],
): ICrmQuarantineView {
  return {
    businessName,
    explainer: [...QUARANTINE_EXPLAINER],
    note: quarantineBusinessNote(businessName),
    offers: offers.map((offer) => ({
      offerId: offer.offerId,
      verdicts: offer.verdicts.map((verdict) => ({
        type: verdict.type,
        title: verdictTitle(verdict.type),
        currentPrice: verdict.currentPrice ?? null,
        lastValidPrice: verdict.lastValidPrice ?? null,
        minPrice: verdict.minPrice ?? null,
      })),
    })),
  };
}

/** Артикулы из тела POST: непустые строки ≤255, без повторов; иначе null. */
export function parseOfferIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const id = item.trim();
    if (!id || id.length > OFFER_ID_MAX) return null;
    ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * Что из запрошенного ещё в карантине. Подтверждается только это: иначе
 * устаревшая вкладка подтвердила бы цену, которую продавец не видел
 * (бот ту же защиту получает индексами кнопок).
 */
export function splitByLive(
  requested: readonly string[],
  live: readonly IQuarantineOffer[],
): { toConfirm: string[]; stale: number } {
  const inQuarantine = new Set(live.map((offer) => offer.offerId));
  const toConfirm = requested.filter((id) => inQuarantine.has(id));
  return { toConfirm, stale: requested.length - toConfirm.length };
}
