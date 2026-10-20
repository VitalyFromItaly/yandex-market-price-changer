/** Имя маршрута — ключ пункта `ym-quarantine` в навигации и CRM_SECTIONS сервера. */
export const QUARANTINE_ROUTE_NAME = 'ym-quarantine';

// --- ответ API --------------------------------------------------------------

export interface QuarantineVerdictResponse {
  type: string;
  title: string;
  currentPrice: number | null;
  lastValidPrice: number | null;
  minPrice: number | null;
}

export interface QuarantineOfferResponse {
  offerId: string;
  verdicts: QuarantineVerdictResponse[];
}

export interface QuarantineViewResponse {
  businessName: string;
  explainer: string[];
  note: string;
  offers: QuarantineOfferResponse[];
}

export interface QuarantineConfirmResponse {
  confirmed: number;
  stale: number;
}

// --- домен ------------------------------------------------------------------

/**
 * Строка таблицы — товар. Цены — `null`, если Маркет их не прислал: «последняя
 * валидная» есть только у резкой смены цены, порог — только у низкой цены.
 * «Нет цены» и «0 ₽» — разные вещи.
 */
export interface QuarantineRow {
  offerId: string;
  /** Причины по-русски — подписи сервера (те же, что в боте). */
  reasons: string[];
  currentPrice: number | null;
  lastValidPrice: number | null;
  minPrice: number | null;
}

export interface QuarantineView {
  explainer: string[];
  note: string;
  rows: QuarantineRow[];
}

export interface QuarantineConfirmResult {
  confirmed: number;
  stale: number;
}

/** Что подтверждаем: одну строку, отмеченные или всё. */
export type ConfirmTarget =
  | { kind: 'one'; offerId: string }
  | { kind: 'selected' }
  | { kind: 'all' };
