/**
 * «Карточки» — зеркало ответа фоновой задачи `cards:report`
 * (toCrmCardsView в src/modules/crm/cards/crm-cards.domain.ts).
 *
 * Сводка и подписи статусов/рекомендаций приходят с сервера — из того же
 * summarizeCards и тех же таблиц подписей, что у бота.
 */

export const OFFER_CARDS_ROUTE_NAME = 'ym-offer-cards';
export const CARDS_JOB_KIND = 'cards:report';

export interface CardRowResponse {
  offerId: string;
  status: string;
  statusLabel: string;
  actionable: boolean;
  contentRating: number | null;
  averageContentRating: number | null;
  recommendations: string[];
  errorsCount: number;
  warningsCount: number;
}

export interface CardsStatusCount {
  status: string;
  label: string;
  actionable: boolean;
  count: number;
}

export interface CardsResponse {
  takenAt: string;
  summary: {
    totalCards: number;
    byStatus: CardsStatusCount[];
    averageRating: number | null;
    averageBenchmark: number | null;
  };
  emptyText: string | null;
  rows: CardRowResponse[];
  file: { filename: string; rows: number; truncated: number } | null;
}

export interface CardRow extends CardRowResponse {
  id: string;
}

export interface CardsReport {
  /** «на ДД-ММ-ГГГГ ЧЧ:ММ МСК». */
  heading: string;
  totalCards: number;
  byStatus: CardsStatusCount[];
  averageRating: number | null;
  averageBenchmark: number | null;
  emptyText: string | null;
  rows: CardRow[];
  file: { filename: string; rows: number; truncated: number } | null;
}

export type CardsFilter = 'all' | 'actionable' | 'rest';

export const CARDS_FILTERS: readonly { value: CardsFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'actionable', label: 'Требуют действий' },
  { value: 'rest', label: 'Остальные' },
];

export type CardSortKey = 'offerId' | 'status' | 'contentRating' | 'errorsCount' | 'warningsCount';
export type SortDir = 'asc' | 'desc';
