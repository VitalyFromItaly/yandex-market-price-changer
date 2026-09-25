import type {
  FeedbackPart,
  FeedbackResponse,
  FeedbackRow,
  FeedbackView,
  FeedbackViewResponse,
} from '../feedback.domain';

import { formatMoscowDate } from '@/shared/utils';

/** Звёзды как в боте; оценка вне 1..5 — неизвестна, а не «ноль». */
export function starsOf(rating: number | null): string | null {
  if (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function partsOf(feedback: FeedbackResponse): FeedbackPart[] {
  const parts: FeedbackPart[] = [];
  if (feedback.advantages !== null) parts.push({ label: 'Достоинства', text: feedback.advantages });
  if (feedback.disadvantages !== null) {
    parts.push({ label: 'Недостатки', text: feedback.disadvantages });
  }
  if (feedback.comment !== null) parts.push({ label: 'Комментарий', text: feedback.comment });
  return parts;
}

export function mapFeedbackRow(feedback: FeedbackResponse): FeedbackRow {
  const stars = starsOf(feedback.rating);
  return {
    feedbackId: feedback.feedbackId,
    rating: stars === null ? null : feedback.rating,
    stars,
    author: feedback.author,
    date: feedback.createdAt === null ? null : formatMoscowDate(feedback.createdAt),
    orderId: feedback.orderId,
    parts: partsOf(feedback),
  };
}

/** Текст отзыва одним блоком — цитата над полем ответа. */
export function feedbackQuote(row: FeedbackRow): string {
  return row.parts.map((part) => `${part.label}: ${part.text}`).join('\n');
}

export function mapFeedbackView(response: FeedbackViewResponse): FeedbackView {
  return {
    note: response.note,
    publicNote: response.publicNote,
    productNote: response.productNote,
    more: response.more,
    replyMaxLength: response.replyMaxLength,
    rows: response.feedbacks.map(mapFeedbackRow),
  };
}
