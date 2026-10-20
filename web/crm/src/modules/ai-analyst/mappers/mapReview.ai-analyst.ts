import type {
  PeriodReviewModel,
  PeriodReviewResponse,
  RecommendationCard,
  ReviewRecommendationResponse,
} from '../ai-analyst.domain';

import { toAnswerModel, toSourceLink } from './mapAnswer.ai-analyst';

import { monthLabel } from '@/shared/period';

function toCard(r: ReviewRecommendationResponse, index: number): RecommendationCard {
  return {
    id: r.id,
    title: r.name ? `${r.name} · ${r.sku}` : r.sku,
    text: r.text,
    schemes: r.schemes.join(', '),
    source: toSourceLink(r.source, index),
  };
}

/** Разбор сервера → модель вкладки: текст как ответ чата, карточки рекомендаций со ссылками. */
export function toReviewModel(response: PeriodReviewResponse): PeriodReviewModel {
  const title = `${monthLabel(response.month)} · к ${monthLabel(response.previousMonth)}`;
  const answer =
    response.answer === null
      ? null
      : toAnswerModel({
          answer: response.answer,
          verification: response.verification,
          sources: response.sources,
          gaps: response.gaps,
          rounds: 1,
        });
  return {
    title,
    answer,
    recommendations: response.recommendations.map(toCard),
    gaps: answer ? [] : response.gaps,
  };
}
