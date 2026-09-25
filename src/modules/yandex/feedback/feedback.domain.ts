/**
 * Отзывы о товарах — типы, разбор ответа Partner API и кодек inline-кнопок.
 *
 * Чистый модуль (паттерн `report-buttons.ts`): кодек читают кнопка, обработчик
 * нажатия и гейт возможностей, и последний обязан остаться без Nest/telegraf.
 */

/** Отзыв в терминах экрана. */
export interface IGoodsFeedback {
  /** int64 — влезает в callback_data, в отличие от артикулов карантина. */
  feedbackId: number;
  createdAt?: string;
  /** Имя автора; Маркет может не отдать. */
  author?: string;
  /** Оценка 1..5. */
  rating?: number;
  orderId?: number;
  /** Три текстовых поля отзыва; любое может отсутствовать. */
  advantages?: string;
  disadvantages?: string;
  comment?: string;
}

/**
 * Лимит текста ответа — из спеки (`GoodsFeedbackCommentText`: maxLength 4096).
 * Проверяем ДО отправки: 400 от Маркета на длинном тексте потерял бы ответ,
 * который продавец уже набрал.
 */
export const FEEDBACK_REPLY_MAX_LENGTH = 4096;

/** Что не так с текстом ответа — или null, если его можно публиковать. */
export type TFeedbackReplyProblem = 'empty' | 'too-long';

/**
 * Проверка текста ответа перед публикацией — одна на оба канала: бот
 * переспрашивает по ней, CRM отвечает 400, `FeedbackService` — последний барьер.
 */
export function feedbackReplyProblem(text: string): TFeedbackReplyProblem | null {
  if (!text.trim()) return 'empty';
  if (text.length > FEEDBACK_REPLY_MAX_LENGTH) return 'too-long';
  return null;
}

/** Текст ответа, который публиковать нельзя, дошёл до сервиса. */
export class FeedbackReplyInvalidError extends Error {
  constructor(public readonly problem: TFeedbackReplyProblem) {
    super(`Ответ на отзыв не опубликован: ${problem}`);
    this.name = 'FeedbackReplyInvalidError';
  }
}

/** Сырой отзыв из ответа Partner API. */
export type TRawGoodsFeedback = {
  feedbackId?: number;
  createdAt?: string;
  author?: string;
  identifiers?: { orderId?: number };
  description?: { advantages?: string; disadvantages?: string; comment?: string };
  statistics?: { rating?: number };
};

/** Разбор одного отзыва, либо null без идентификатора — ответить нечем. */
export function parseGoodsFeedback(raw: TRawGoodsFeedback): IGoodsFeedback | null {
  const feedbackId = raw?.feedbackId;
  if (typeof feedbackId !== 'number') return null;

  return {
    feedbackId,
    createdAt: raw.createdAt,
    author: raw.author,
    rating: raw.statistics?.rating,
    orderId: raw.identifiers?.orderId,
    advantages: raw.description?.advantages,
    disadvantages: raw.description?.disadvantages,
    comment: raw.description?.comment,
  };
}

// --- кодек inline-кнопок ------------------------------------------------------
//
// `re` открывает вопрос «пришлите текст ответа», `skip` помечает прочитанным,
// `send`/`cancel` — кнопки превью черновика. Публикует ТОЛЬКО `send`: ответ на
// отзыв — публичный текст на Маркете, и без явного подтверждения любое
// случайное сообщение после «Ответить» улетало бы наружу (довод dryRun).

export const FB_CB_PATTERN = /^fb:(re|skip|send):\d+$|^fb:cancel$/;

export type TFbCallback =
  | { action: 're' | 'skip' | 'send'; feedbackId: number }
  | { action: 'cancel' };

export function fbReplyCallback(feedbackId: number): string {
  return `fb:re:${feedbackId}`;
}

export function fbSkipCallback(feedbackId: number): string {
  return `fb:skip:${feedbackId}`;
}

export function fbSendCallback(feedbackId: number): string {
  return `fb:send:${feedbackId}`;
}

export const FB_CB_CANCEL = 'fb:cancel';

export function parseFbCallback(data: string | undefined): TFbCallback | null {
  const value = data ?? '';
  if (!FB_CB_PATTERN.test(value)) return null;
  if (value === FB_CB_CANCEL) return { action: 'cancel' };

  const [, action, id] = value.split(':');
  return { action: action as 're' | 'skip' | 'send', feedbackId: Number(id) };
}
