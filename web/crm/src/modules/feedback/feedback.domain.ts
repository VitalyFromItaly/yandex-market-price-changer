import type { TurnStatus } from '@/shared/composables/useTurn';

/** Имя маршрута — ключ пункта `ym-feedback` в навигации и CRM_SECTIONS сервера. */
export const FEEDBACK_ROUTE_NAME = 'ym-feedback';

/** Фича «✨ Предложить ответ» (TASK-167); сервер требует ещё goods_feedback и ai. */
export const FEEDBACK_AI_REPLY_FEATURE = 'feedback_ai_reply';

/** Код 409 сервера: отзыв уже обработан (другая вкладка, кабинет, бот). */
export const FEEDBACK_GONE = 'FEEDBACK_GONE';

// --- ответ API --------------------------------------------------------------

export interface FeedbackResponse {
  feedbackId: number;
  createdAt: string | null;
  author: string | null;
  rating: number | null;
  orderId: number | null;
  advantages: string | null;
  disadvantages: string | null;
  comment: string | null;
}

export interface FeedbackViewResponse {
  businessName: string;
  note: string;
  publicNote: string;
  productNote: string;
  more: string | null;
  replyMaxLength: number;
  feedbacks: FeedbackResponse[];
}

/** Черновик ИИ: `message` — почему превью сразу нельзя, `gone` — отзыв уже обработан. */
export interface FeedbackDraftResponse {
  text: string;
  gone: boolean;
  message: string | null;
}

export interface FeedbackDraftTurnResponse {
  status: TurnStatus;
  answer?: FeedbackDraftResponse;
  message?: string;
}

// --- домен ------------------------------------------------------------------

/** Текстовая часть отзыва: подпись и текст. Пустые поля в список не попадают. */
export interface FeedbackPart {
  label: string;
  text: string;
}

/**
 * Строка таблицы — отзыв. `null` — «Маркет не прислал», не «пусто»: у отзыва
 * без оценки нет звёзд, а не ноль звёзд. Товара нет вовсе — Partner API его не
 * отдаёт, только номер заказа.
 */
export interface FeedbackRow {
  feedbackId: number;
  /** Оценка 1..5 или null. */
  rating: number | null;
  /** «★★☆☆☆» — только при известной оценке. */
  stars: string | null;
  author: string | null;
  /** ДД-ММ-ГГГГ по Москве. */
  date: string | null;
  orderId: number | null;
  parts: FeedbackPart[];
}

export interface FeedbackView {
  note: string;
  publicNote: string;
  productNote: string;
  /** «Показаны первые N…» — только когда очередь длиннее страницы. */
  more: string | null;
  replyMaxLength: number;
  rows: FeedbackRow[];
}

/** Итог записи: ошибка несёт текст сервера и признак «отзыв уже обработан». */
export type FeedbackWriteResult =
  | { ok: true }
  | { ok: false; message: string; gone: boolean; field: string | null };
