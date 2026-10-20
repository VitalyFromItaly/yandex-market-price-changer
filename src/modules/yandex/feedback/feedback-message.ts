import type { IGoodsFeedback, TFeedbackReplyProblem } from './feedback.domain';

import { b, esc, i } from '../../telegram/formatting/telegram-format';

import {
  FB_CB_CANCEL,
  FEEDBACK_REPLY_MAX_LENGTH,
  fbDraftCallback,
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

export const FEEDBACK_EMPTY_PLAIN = 'Отзывов без ответа нет — всё прочитано.';

export const FEEDBACK_LOAD_ERROR_PLAIN = 'Не удалось получить отзывы. Попробуйте позже.';

/** Ответ публичный — это продавец должен знать до того, как начнёт писать. */
export const FEEDBACK_PUBLIC_NOTE = 'Ответ уходит на Яндекс.Маркет и виден всем покупателям.';

/**
 * В отзыве Partner API нет ни артикула, ни названия товара — только номер
 * заказа (и устаревший modelId). Сказать это лучше, чем оставить продавца
 * искать товар, которого на экране нет.
 */
export const FEEDBACK_NO_PRODUCT_NOTE =
  'Маркет не сообщает, о каком товаре отзыв, — указан номер заказа.';

/**
 * Отзывы — на уровне кабинета (`/businesses/{id}/goods-feedback`), а в CRM
 * раздел живёт внутри магазина (довод `quarantineBusinessNote`).
 */
export function feedbackBusinessNote(businessName: string): string {
  const cabinet = businessName ? `кабинета «${businessName}»` : 'кабинета';
  return (
    `Список общий для всех магазинов ${cabinet}: ` +
    'ответ или «Пропустить» убирают отзыв из списка во всех них.'
  );
}

/** Показана не вся очередь: одна страница Partner API, без полного обхода. */
export function feedbackMorePlain(shown: number): string {
  return `Показаны первые ${shown} — ответьте на них, придут следующие.`;
}

export function feedbackEmptyText(): string {
  return `💬 ${FEEDBACK_EMPTY_PLAIN}`;
}

export function feedbackErrorText(): string {
  return `❌ ${FEEDBACK_LOAD_ERROR_PLAIN}`;
}

/**
 * Шапка экрана. Счётчик честен в пределах страницы Partner API (50): при
 * следующей странице пишем «50+», а не точное число — его пришлось бы добывать
 * полным обходом ради одной цифры. `shown` — сколько карточек напечатано ниже.
 */
export function feedbackHeaderText(onPage: number, hasNextPage: boolean, shown: number): string {
  const count = hasNextPage ? `${onPage}+` : String(onPage);
  const lines = [`💬 ${b('Отзывы без ответа')}: ${count}`, '', FEEDBACK_PUBLIC_NOTE];
  if (shown < onPage || hasNextPage) {
    lines.push(feedbackMorePlain(shown));
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

// --- «✨ Предложить ответ»: черновик от ИИ ------------------------------------

export const FEEDBACK_DRAFT_BUTTON = '✨ Предложить ответ';

/** Модель могла увидеть только текст отзыва — проверить черновик обязан человек. */
export const FEEDBACK_DRAFT_CHECK_NOTE =
  'Это черновик ИИ: проверьте его перед публикацией — опубликует только ваша кнопка.';

/** Что сказать о черновике, который нельзя показать превью. Общая на оба канала. */
export function feedbackDraftProblemPlain(problem: TFeedbackReplyProblem): string {
  if (problem === 'too-long') {
    return (
      `Черновик длиннее ${FEEDBACK_REPLY_MAX_LENGTH} символов — ` +
      'сократите его или попросите предложить ещё раз.'
    );
  }
  return 'ИИ не предложил текст — попросите ещё раз или напишите ответ сами.';
}

/** Отзыва нет среди ждущих ответа, пока модель думала. */
export const FEEDBACK_DRAFT_GONE_PLAIN = 'На этот отзыв уже ответили или пропустили его.';

/** Кнопка под вопросом «пришлите текст» — только если фича открыта. */
export function feedbackDraftButtons(
  feedbackId: number,
): Array<{ text: string; callback_data: string }> {
  return [{ text: FEEDBACK_DRAFT_BUTTON, callback_data: fbDraftCallback(feedbackId) }];
}

export function feedbackDraftQueuedText(): string {
  return '✨ Готовлю черновик ответа — пришлю, как будет готов. Бот пока отвечает на другие кнопки.';
}

export function feedbackDraftBusyText(): string {
  return '⏳ Черновик уже готовится — дождитесь его.';
}

/**
 * Черновик есть, но превью невозможно (длинный): показываем текст и
 * оставляем вопрос открытым — продавец пришлёт свой вариант.
 */
export function feedbackDraftProblemText(problem: TFeedbackReplyProblem, draft: string): string {
  const lines = [`⚠️ ${feedbackDraftProblemPlain(problem)}`];
  if (draft) lines.push('', `«${esc(draft)}»`);
  lines.push('', 'Пришлите свой текст ответа — или нажмите кнопку ещё раз.');
  return lines.join('\n');
}

/**
 * Превью черновика с кнопками «Отправить/Отмена». Публикует только кнопка:
 * ответ — публичный текст на Маркете, случайное сообщение не должно улетать.
 */
export function feedbackPreviewText(draft: string, fromAi = false): string {
  const lines = ['📝 Вот что будет опубликовано в ответ на отзыв:', '', `«${esc(draft)}»`, ''];
  if (fromAi)
    lines.push(i(FEEDBACK_DRAFT_CHECK_NOTE), 'Хотите изменить — пришлите свой текст.', '');
  lines.push('Отправить?');
  return lines.join('\n');
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
