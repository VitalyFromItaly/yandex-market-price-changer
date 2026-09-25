import type { IRecommendationsReport } from '../../yandex/recommendations/recommendations.service';

import { recommendationsEmptyText } from '../../yandex/recommendations/recommendations-message';
import {
  competitivenessLabel,
  recommendationDelta,
} from '../../yandex/recommendations/recommendations.domain';
import { moscowStamp } from '../../yandex/reports/moscow-day';
import { withoutIcon } from '../jobs/crm-jobs.domain';

/**
 * «Рекомендации цен» в CRM — чистая часть: вид ответа фоновой задачи.
 *
 * Своей арифметики здесь нет: порядок строк и дельта — из домена бота
 * (`sortByDeltaDesc` в сервисе, `recommendationDelta`), подписи оценок — из
 * `competitivenessLabel`, общей с книгой.
 */

/** Имя kind-а фоновой задачи. Параметров у отчёта нет — это срез «сейчас». */
export const RECOMMENDATIONS_JOB_KIND = 'recommendations:report';

export interface ICrmRecommendationRow {
  offerId: string;
  price: number | null;
  optimalPrice: number | null;
  averagePrice: number | null;
  competitiveness: string;
  competitivenessLabel: string;
  shows: number | null;
  /** price − optimalPrice; null — нет цены или порога (не ноль: довод orderPurchase). */
  deltaAbs: number | null;
  deltaPercent: number | null;
}

export interface ICrmRecommendationsView {
  /** Момент среза «ДД-ММ-ГГГГ ЧЧ:ММ» (МСК) — снапшот без времени не сверить. */
  takenAt: string;
  count: number;
  average: number;
  low: number;
  other: number;
  /** Текст пустого среза — тот же, что у бота, без значка; null — строки есть. */
  emptyText: string | null;
  rows: ICrmRecommendationRow[];
  file: { filename: string; rows: number; truncated: number } | null;
}

/**
 * Вид ответа. Никогда не null, даже без строк: `useReportJob` считает задачу
 * идущей, пока `data === null` (урок TASK-084).
 */
export function toCrmRecommendationsView(report: IRecommendationsReport): ICrmRecommendationsView {
  const rows = report.rows.map((row): ICrmRecommendationRow => {
    const delta = recommendationDelta(row);
    return {
      offerId: row.offerId,
      price: row.price ?? null,
      optimalPrice: row.optimalPrice ?? null,
      averagePrice: row.averagePrice ?? null,
      competitiveness: row.competitiveness,
      competitivenessLabel: competitivenessLabel(row.competitiveness),
      shows: row.shows ?? null,
      deltaAbs: delta ? Math.round(delta.abs * 100) / 100 : null,
      deltaPercent: delta ? delta.percent : null,
    };
  });
  const average = rows.filter((row) => row.competitiveness === 'AVERAGE').length;
  const low = rows.filter((row) => row.competitiveness === 'LOW').length;
  const { workbook } = report;

  return {
    takenAt: moscowStamp(report.takenAt),
    count: rows.length,
    average,
    low,
    other: rows.length - average - low,
    emptyText: rows.length ? null : withoutIcon(recommendationsEmptyText()),
    rows,
    file: workbook
      ? { filename: workbook.filename, rows: workbook.rows, truncated: workbook.truncated }
      : null,
  };
}
