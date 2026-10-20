import type { IFeedbackDraft } from '../../yandex/feedback/feedback-draft.domain';
import type { IGoodsFeedback } from '../../yandex/feedback/feedback.domain';

import {
  FEEDBACK_NO_PRODUCT_NOTE,
  FEEDBACK_PUBLIC_NOTE,
  feedbackBusinessNote,
  feedbackDraftProblemPlain,
  feedbackMorePlain,
} from '../../yandex/feedback/feedback-message';
import {
  FEEDBACK_REPLY_MAX_LENGTH,
  feedbackReplyProblem,
} from '../../yandex/feedback/feedback.domain';

/**
 * Отзывы в CRM: форма ответа, разбор тел записи, коды ошибок.
 * Чистый модуль (паттерн crm-quarantine.domain).
 */

/** 400: нет или битый feedbackId. */
export const INVALID_FEEDBACK = 'INVALID_FEEDBACK';
export const INVALID_FEEDBACK_TEXT = 'Не выбран отзыв.';
/** 400: текст ответа пуст или длиннее лимита Маркета; `field: 'text'`. */
export const INVALID_REPLY = 'INVALID_REPLY';
/**
 * 409: отзыва уже нет среди ждущих ответа — на него ответили или его
 * пропустили (другая вкладка, кабинет, бот). Записи не было: второй публичный
 * комментарий хуже, чем «обновите список».
 */
export const FEEDBACK_GONE = 'FEEDBACK_GONE';
export const FEEDBACK_GONE_TEXT = 'Отзыв уже обработан — список обновлён.';

export interface ICrmFeedback {
  feedbackId: number;
  /** null, а не '': Маркет может не прислать любое из полей. */
  createdAt: string | null;
  author: string | null;
  rating: number | null;
  /** Единственная привязка к товару, которую отдаёт Partner API. */
  orderId: number | null;
  advantages: string | null;
  disadvantages: string | null;
  comment: string | null;
}

export interface ICrmFeedbackView {
  /** Имя кабинета: отзывы общие на все его магазины. */
  businessName: string;
  note: string;
  publicNote: string;
  productNote: string;
  /** «Показаны первые N…» — только когда у Маркета есть следующая страница. */
  more: string | null;
  /** Лимит длины ответа — фронт берёт его отсюда, не держит свою копию. */
  replyMaxLength: number;
  feedbacks: ICrmFeedback[];
}

/** Ответ перечислением полей — довод `/auth/me`: ничего лишнего из ответа Маркета. */
export function toCrmFeedbackView(
  businessName: string,
  page: { items: readonly IGoodsFeedback[]; nextPageToken?: string },
): ICrmFeedbackView {
  return {
    businessName,
    note: feedbackBusinessNote(businessName),
    publicNote: FEEDBACK_PUBLIC_NOTE,
    productNote: FEEDBACK_NO_PRODUCT_NOTE,
    more: page.nextPageToken ? feedbackMorePlain(page.items.length) : null,
    replyMaxLength: FEEDBACK_REPLY_MAX_LENGTH,
    feedbacks: page.items.map((feedback) => ({
      feedbackId: feedback.feedbackId,
      createdAt: textOrNull(feedback.createdAt),
      author: textOrNull(feedback.author),
      rating: numberOrNull(feedback.rating),
      orderId: numberOrNull(feedback.orderId),
      advantages: textOrNull(feedback.advantages),
      disadvantages: textOrNull(feedback.disadvantages),
      comment: textOrNull(feedback.comment),
    })),
  };
}

/** feedbackId из тела: положительное целое (int64 Маркета влезает в число). */
export function parseFeedbackId(value: unknown): number | null {
  const id = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Текст ответа из тела — или текст ошибки для поля. Публикуется ровно то, что
 * продавец видел в превью: текст не обрезается и не нормализуется.
 */
export function parseReplyText(value: unknown): { text: string } | { error: string } {
  const text = typeof value === 'string' ? value : '';
  const problem = feedbackReplyProblem(text);
  if (problem === 'empty') return { error: 'Напишите текст ответа.' };
  if (problem === 'too-long') {
    return {
      error:
        `Ответ слишком длинный: ${text.length} символов при лимите ` +
        `${FEEDBACK_REPLY_MAX_LENGTH}. Сократите его.`,
    };
  }
  return { text };
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// --- «✨ Предложить ответ» -----------------------------------------------------

/**
 * Готовый черновик ИИ для диалога «Ответить». `message` — почему превью
 * сразу нельзя (длинный, пустой) или почему диалог закрывается (`gone`).
 * Текст лежит только в памяти хода (TTL 10 мин) — решение
 * `feedback_ai_draft_in_memory`.
 */
export interface ICrmFeedbackDraft {
  text: string;
  /** Отзыв уже не ждёт ответа — фронт закрывает диалог, как при 409. */
  gone: boolean;
  message: string | null;
}

export function toCrmFeedbackDraft(draft: IFeedbackDraft): ICrmFeedbackDraft {
  return {
    text: draft.text,
    gone: false,
    message: draft.problem ? feedbackDraftProblemPlain(draft.problem) : null,
  };
}

export const CRM_FEEDBACK_DRAFT_GONE: ICrmFeedbackDraft = {
  text: '',
  gone: true,
  message: FEEDBACK_GONE_TEXT,
};
