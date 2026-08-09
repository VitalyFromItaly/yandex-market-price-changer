import type { IGoodsFeedback } from './feedback.domain';

import { b, esc, i } from '../../telegram/formatting/telegram-format';

import {
  FB_CB_CANCEL,
  FEEDBACK_REPLY_MAX_LENGTH,
  fbReplyCallback,
  fbSendCallback,
  fbSkipCallback,
} from './feedback.domain';

/**
 * Экран «💬 Отзывы» — единственный источник его текстов (правило «один экран —
 * один текст»).
 */

/** Сколько отзывов показывать за раз: у каждого 1–2 ряда кнопок и свой текст. */
export const FEEDBACK_SHOW_LIMIT = 5;

export function feedbackEmptyText(): string {
  return '💬 Отзывов без ответа нет — всё прочитано.';
}

export function feedbackErrorText(): string {
  return '❌ Не удалось получить отзывы. Попробуйте позже.';
}

/**
 * Шапка экрана. Счётчик честен в пределах страницы Partner API (50): при
 * следующей странице пишем «50+», а не точное число — его пришлось бы добывать
 * полным обходом ради одной цифры. `shown` — сколько карточек напечатано ниже.
 */
export function feedbackHeaderText(onPage: number, hasNextPage: boolean, shown: number): string {
  const count = hasNextPage ? `${onPage}+` : String(onPage);
  const lines = [
    `💬 ${b('Отзывы без ответа')}: ${count}`,
    '',
    'Ответ уходит на Яндекс.Маркет и виден всем покупателям.',
  ];
  if (shown < onPage || hasNextPage) {
    lines.push(`Показаны первые ${shown} — ответьте на них, придут следующие.`);
  }
  return lines.join('\n');
}

/** Один отзыв: звёзды, автор, дата, три текстовых поля. */
export function feedbackCardText(feedback: IGoodsFeedback, index: number): string {
  const lines: string[] = [];
  const author = feedback.author ? ` — ${esc(feedback.author)}` : '';
  lines.push(`${index}. ${stars(feedback.rating)}${author}${formatDate(feedback.createdAt)}`);

  if (feedback.advantages) lines.push(`➕ ${esc(feedback.advantages)}`);
  if (feedback.disadvantages) lines.push(`➖ ${esc(feedback.disadvantages)}`);
  if (feedback.comment) lines.push(`💬 ${esc(feedback.comment)}`);
  if (!feedback.advantages && !feedback.disadvantages && !feedback.comment) {
    lines.push(i('Без текста — только оценка.'));
  }

  return lines.join('\n');
}

/** Кнопки одного отзыва: ответить или пометить прочитанным. */
export function feedbackCardButtons(
  feedback: IGoodsFeedback,
): Array<{ text: string; callback_data: string }> {
  return [
    { text: '✍️ Ответить', callback_data: fbReplyCallback(feedback.feedbackId) },
    { text: '✅ Прочитано', callback_data: fbSkipCallback(feedback.feedbackId) },
  ];
}

/** Вопрос после кнопки «Ответить». */
export function feedbackAskReplyText(): string {
  return [
    '✍️ Пришлите текст ответа на отзыв.',
    '',
    'Перед публикацией я покажу его и спрошу подтверждение.',
    'Передумали — нажмите любую кнопку меню.',
  ].join('\n');
}

/**
 * Превью черновика с кнопками «Отправить/Отмена». Публикует только кнопка:
 * ответ — публичный текст на Маркете, случайное сообщение не должно улетать.
 */
export function feedbackPreviewText(draft: string): string {
  return [
    '📝 Вот что будет опубликовано в ответ на отзыв:',
    '',
    `«${esc(draft)}»`,
    '',
    'Отправить?',
  ].join('\n');
}

export function feedbackPreviewButtons(
  feedbackId: number,
): Array<{ text: string; callback_data: string }> {
  return [
    { text: '✅ Отправить', callback_data: fbSendCallback(feedbackId) },
    { text: '❌ Отмена', callback_data: FB_CB_CANCEL },
  ];
}

export function feedbackTooLongText(length: number): string {
  return (
    `❌ Ответ слишком длинный: ${length} символов при лимите ` +
    `${FEEDBACK_REPLY_MAX_LENGTH}. Сократите и пришлите ещё раз.`
  );
}

export function feedbackSentText(): string {
  return '✅ Ответ опубликован на Яндекс.Маркете.';
}

export function feedbackSkippedText(): string {
  return '✅ Отзыв помечен прочитанным.';
}

export function feedbackCancelledText(): string {
  return 'Ответ отменён — ничего не опубликовано.';
}

/** Черновик потерялся (например, рестарт между превью и кнопкой). */
export function feedbackDraftLostText(): string {
  return 'Черновик не найден — нажмите «✍️ Ответить» и пришлите текст ещё раз.';
}

function stars(rating: number | undefined): string {
  if (!rating || rating < 1 || rating > 5) return '★—';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/** Дата отзыва по-московски коротко; битую дату не печатаем вовсе. */
function formatDate(createdAt: string | undefined): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  return `, ${formatted}`;
}
