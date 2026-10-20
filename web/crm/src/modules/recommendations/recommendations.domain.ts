/**
 * «Рекомендации цен» — зеркало ответа фоновой задачи `recommendations:report`
 * (toCrmRecommendationsView в src/modules/crm/recommendations/crm-recommendations.domain.ts).
 *
 * Дельта, порядок и подписи оценок приходят с сервера — из того же домена, что
 * у бота. Фронт только фильтрует, сортирует и ищет.
 */

export const RECOMMENDATIONS_ROUTE_NAME = 'ym-recommendations';
export const RECOMMENDATIONS_JOB_KIND = 'recommendations:report';

export interface RecommendationRowResponse {
  offerId: string;
  price: number | null;
  optimalPrice: number | null;
  averagePrice: number | null;
  competitiveness: string;
  competitivenessLabel: string;
  shows: number | null;
  /** null — нет цены или порога; не ноль. */
  deltaAbs: number | null;
  deltaPercent: number | null;
}

export interface RecommendationsResponse {
  takenAt: string;
  count: number;
  average: number;
  low: number;
  other: number;
  emptyText: string | null;
  rows: RecommendationRowResponse[];
  file: { filename: string; rows: number; truncated: number } | null;
}

export interface RecommendationRow extends RecommendationRowResponse {
  id: string;
}

export interface RecommendationsReport {
  /** «на ДД-ММ-ГГГГ ЧЧ:ММ МСК» — срез без момента нечем сверить с кабинетом. */
  heading: string;
  count: number;
  average: number;
  low: number;
  other: number;
  emptyText: string | null;
  rows: RecommendationRow[];
  file: { filename: string; rows: number; truncated: number } | null;
}

/** Фильтр по оценке Маркета. OPTIMAL Маркет не присылает — его в фильтре нет. */
export type CompetitivenessFilter = 'all' | 'AVERAGE' | 'LOW';

export const COMPETITIVENESS_FILTERS: readonly { value: CompetitivenessFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'AVERAGE', label: 'Умеренная' },
  { value: 'LOW', label: 'Непривлекательная' },
];

export type RecommendationSortKey = 'offerId' | 'price' | 'deltaAbs' | 'deltaPercent' | 'shows';
export type SortDir = 'asc' | 'desc';
