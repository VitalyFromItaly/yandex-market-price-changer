import type { IGoodsFeedback, TFeedbackReplyProblem } from './feedback.domain';
import type { TAiPurpose } from '../../ai/ai-purpose';
import type { IPolzaMessage } from '../../ai/polza.client';

/**
 * Черновик ответа на отзыв от ИИ — промпт и форма результата. Чистый модуль:
 * его читают сервис, тесты промпта и (через сервис) оба канала.
 *
 * ИИ даёт ТОЛЬКО черновик: публикует прежний шаг превью кнопкой продавца.
 * Ответ публичный и без отката — довод dryRun.
 */

/** `purpose` строки AiUsage: по нему считаются расходы функции. */
export const FEEDBACK_DRAFT_PURPOSE: TAiPurpose = 'feedback-reply';

/**
 * Сколько символов просим у модели. Сильно меньше лимита Маркета (4096):
 * длинный ответ на отзыв никто не читает, а запас оставляет место правке.
 * Лимит Маркета проверяет `feedbackReplyProblem` — модель могла не послушаться.
 */
export const FEEDBACK_DRAFT_TARGET_LENGTH = 800;

/** Потолок ответа модели в токенах: ~800 символов кириллицы с запасом. */
export const FEEDBACK_DRAFT_MAX_TOKENS = 1200;

/** Черновик и что с ним не так (null — можно показывать превью). */
export interface IFeedbackDraft {
  text: string;
  problem: TFeedbackReplyProblem | null;
}

/**
 * Системный текст. Запреты — из того, что ответ публичный и от имени
 * продавца: обещание возврата/замены становится обязательством, спор с
 * покупателем и упоминание конкурентов бьют по репутации, а характеристики
 * товара модель знать не может — в отзыве Partner API товара нет
 * (`FEEDBACK_NO_PRODUCT_NOTE`).
 */
export function feedbackDraftPrompt(): string {
  return [
    'Ты помогаешь продавцу на Яндекс.Маркете ответить на отзыв покупателя. Пиши по-русски, ' +
      'от имени продавца, вежливо и спокойно.',
    'Поблагодари за отзыв. На критику — признай неудобство и предложи написать продавцу в чат ' +
      'заказа на Маркете, чтобы разобраться.',
    'Нельзя: обещать возврат денег, замену товара, компенсацию, скидку или подарок; спорить ' +
      'с покупателем или обвинять его; упоминать конкурентов, другие магазины и цены.',
    'Нельзя выдумывать характеристики, состав, комплектацию или свойства товара: о каком товаре ' +
      'отзыв, неизвестно. Говори только о том, что написал покупатель.',
    `Длина — не больше ${FEEDBACK_DRAFT_TARGET_LENGTH} символов. Без приветствия по имени, ` +
      'без подписи, без markdown и эмодзи. Верни только текст ответа.',
  ].join('\n');
}

/** Отзыв — отдельным сообщением: оценка и три текстовых поля, как пришли. */
export function toFeedbackDraftMessages(feedback: IGoodsFeedback): IPolzaMessage[] {
  const lines = [`Оценка: ${feedback.rating ? `${feedback.rating} из 5` : 'не указана'}`];
  if (feedback.advantages) lines.push(`Достоинства: ${feedback.advantages}`);
  if (feedback.disadvantages) lines.push(`Недостатки: ${feedback.disadvantages}`);
  if (feedback.comment) lines.push(`Комментарий: ${feedback.comment}`);
  if (!feedback.advantages && !feedback.disadvantages && !feedback.comment) {
    lines.push('Текста нет — только оценка.');
  }
  return [
    { role: 'system', content: feedbackDraftPrompt() },
    { role: 'user', content: `Отзыв покупателя:\n${lines.join('\n')}` },
  ];
}
