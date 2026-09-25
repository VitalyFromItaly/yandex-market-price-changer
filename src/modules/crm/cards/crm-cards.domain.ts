import type { ICardsReport } from '../../yandex/cards/cards.service';

import { cardsEmptyText } from '../../yandex/cards/cards-message';
import {
  ACTIONABLE_STATUSES,
  cardStatusLabel,
  recommendationLabel,
} from '../../yandex/cards/cards.domain';
import { moscowStamp } from '../../yandex/reports/moscow-day';
import { withoutIcon } from '../jobs/crm-jobs.domain';

/**
 * «Карточки» в CRM — чистая часть: вид ответа фоновой задачи. Сводка — из
 * `summarizeCards` (сервис), подписи — из домена бота; своей копии нет.
 */

/** Имя kind-а фоновой задачи. Параметров нет — срез «сейчас». */
export const CARDS_JOB_KIND = 'cards:report';

export interface ICrmCardRow {
  offerId: string;
  status: string;
  statusLabel: string;
  /** Статус требует действия продавца (`ACTIONABLE_STATUSES`). */
  actionable: boolean;
  contentRating: number | null;
  averageContentRating: number | null;
  /** Подписи рекомендаций по-русски, в порядке Маркета. */
  recommendations: string[];
  errorsCount: number;
  warningsCount: number;
}

export interface ICrmCardsView {
  takenAt: string;
  summary: {
    totalCards: number;
    byStatus: { status: string; label: string; actionable: boolean; count: number }[];
    averageRating: number | null;
    averageBenchmark: number | null;
  };
  /** Текст пустого среза — тот же, что у бота, без значка; null — карточки есть. */
  emptyText: string | null;
  rows: ICrmCardRow[];
  file: { filename: string; rows: number; truncated: number } | null;
}

function isActionable(status: string): boolean {
  return ACTIONABLE_STATUSES.includes(status);
}

/** Вид ответа. Никогда не null, даже без карточек (довод `useReportJob`). */
export function toCrmCardsView(report: ICardsReport): ICrmCardsView {
  const { summary, workbook } = report;
  return {
    takenAt: moscowStamp(report.takenAt),
    summary: {
      totalCards: summary.totalCards,
      byStatus: summary.byStatus.map(({ status, count }) => ({
        status,
        label: cardStatusLabel(status),
        actionable: isActionable(status),
        count,
      })),
      averageRating: summary.averageRating,
      averageBenchmark: summary.averageBenchmark,
    },
    emptyText: report.cards.length ? null : withoutIcon(cardsEmptyText()),
    rows: report.cards.map((card) => ({
      offerId: card.offerId,
      status: card.cardStatus,
      statusLabel: cardStatusLabel(card.cardStatus),
      actionable: isActionable(card.cardStatus),
      contentRating: card.contentRating ?? null,
      averageContentRating: card.averageContentRating ?? null,
      recommendations: card.recommendations.map(recommendationLabel),
      errorsCount: card.errorsCount,
      warningsCount: card.warningsCount,
    })),
    file: workbook
      ? { filename: workbook.filename, rows: workbook.rows, truncated: workbook.truncated }
      : null,
  };
}
