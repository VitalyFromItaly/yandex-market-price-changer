import type { IQuarantineOffer, IQuarantineVerdict } from './quarantine.domain';

import { b, code, esc } from '../../telegram/formatting/telegram-format';

import { PQ_CB_ALL, pqConfirmCallback } from './quarantine.domain';

/**
 * Экран «🚧 Карантин цен» — единственный источник его текстов.
 *
 * Правило «один экран — один текст»: экран рендерится и по кнопке меню, и
 * после каждого подтверждения, и две копии разъехались бы, как когда-то
 * справка.
 */

/**
 * Сколько товаров показывать с кнопками. Больше — и сообщение упирается в
 * лимиты Telegram (100 inline-кнопок, 4096 символов), а карантин на десятки
 * позиций всё равно удобнее подтверждать кнопкой «все».
 */
export const QUARANTINE_SHOW_LIMIT = 10;

/** Подписи типов карантина. Неизвестный код печатается как есть. */
const VERDICT_TITLES: Record<string, string> = {
  PRICE_CHANGE: 'цена изменилась слишком резко',
  LOW_PRICE: 'цена сильно ниже рыночной',
  LOW_PRICE_PROMO: 'цена после акций сильно ниже рыночной',
};

/** Подпись причины карантина; неизвестный код — как есть. Общая для бота и CRM. */
export function verdictTitle(type: string): string {
  return VERDICT_TITLES[type] ?? type;
}

/**
 * Что такое карантин и что с ним делать — без разметки, для обоих каналов.
 * Бот печатает эти строки под шапкой, CRM — над таблицей.
 */
export const QUARANTINE_EXPLAINER: readonly string[] = [
  'Эти товары скрыты с витрины: Маркету цена показалась подозрительной.',
  'Если цена верная — подтвердите её кнопкой, и товар вернётся в продажу.',
  'Если ошибочная — исправьте цену в кабинете или новым прайсом.',
];

/**
 * Карантин — на уровне кабинета (`/businesses/{id}/price-quarantine`), а в CRM
 * раздел живёт внутри магазина. Не сказать этого — значит дать продавцу решить,
 * что подтверждение касается одного магазина.
 */
export function quarantineBusinessNote(businessName: string): string {
  const cabinet = businessName ? `кабинета «${businessName}»` : 'кабинета';
  return (
    `Список общий для всех магазинов ${cabinet}: ` +
    'подтверждённая цена возвращает товар на витрину во всех них.'
  );
}

export const QUARANTINE_EMPTY_PLAIN = 'Карантин пуст — все цены в порядке.';

export const QUARANTINE_LOAD_ERROR_PLAIN = 'Не удалось получить карантин цен. Попробуйте позже.';

/** Часть батчей прошла: сказать, сколько уже на витрине, а не «ничего не вышло». */
export function quarantinePartialText(confirmed: number, requested: number): string {
  return (
    `Подтверждено ${confirmed} из ${requested}: остальные Маркет не принял — ` +
    'список обновлён, подтвердите оставшиеся ещё раз.'
  );
}

export function quarantineEmptyText(): string {
  return `🚧 ${QUARANTINE_EMPTY_PLAIN}`;
}

export function quarantineErrorText(): string {
  return `❌ ${QUARANTINE_LOAD_ERROR_PLAIN}`;
}

/** Ответ на нажатие кнопки, когда сохранённый список уже неактуален. */
export function quarantineStaleText(): string {
  return 'Список устарел — откройте «🚧 Карантин цен» заново.';
}

export function quarantineConfirmedText(count: number): string {
  return count === 1 ? '✅ Цена подтверждена.' : `✅ Подтверждено цен: ${count}.`;
}

/**
 * Текст экрана: шапка-объяснение и нумерованный список.
 *
 * Объяснение обязательно: «карантин» — термин кабинета, и продавец, впервые
 * видящий экран, должен понять главное — товар СКРЫТ с витрины, пока цена не
 * подтверждена или не исправлена.
 */
export function quarantineText(offers: readonly IQuarantineOffer[]): string {
  const shown = offers.slice(0, QUARANTINE_SHOW_LIMIT);

  const lines: string[] = [
    `🚧 ${b('Карантин цен')} — товаров: ${offers.length}`,
    '',
    ...QUARANTINE_EXPLAINER,
    '',
  ];

  shown.forEach((offer, index) => {
    lines.push(`${index + 1}. ${code(offer.offerId)}`);
    for (const verdict of offer.verdicts) {
      lines.push(`   ${esc(verdictLine(verdict))}`);
    }
  });

  if (offers.length > shown.length) {
    lines.push('');
    lines.push(`…и ещё ${offers.length - shown.length}. Подтвердить можно все разом.`);
  }

  return lines.join('\n');
}

/** Одна причина карантина строкой: тип и цены, которые сравнивал Маркет. */
export function verdictLine(verdict: IQuarantineVerdict): string {
  const title = verdictTitle(verdict.type);

  if (verdict.type === 'PRICE_CHANGE') {
    const was = formatPrice(verdict.lastValidPrice);
    const now = formatPrice(verdict.currentPrice);
    return `⚠️ ${title}: была ${was} → стала ${now}`;
  }

  const now = formatPrice(verdict.currentPrice);
  const min = formatPrice(verdict.minPrice);
  return `⚠️ ${title}: ${now} при пороге ${min}`;
}

/**
 * Ряды inline-кнопок: «Подтвердить N» по видимым товарам и «все» одной
 * кнопкой. Кнопки несут индекс, а не артикул — см. quarantine.domain.
 */
export function quarantineKeyboardRows(
  offers: readonly IQuarantineOffer[],
): Array<Array<{ text: string; callback_data: string }>> {
  const shown = offers.slice(0, QUARANTINE_SHOW_LIMIT);
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (let index = 0; index < shown.length; index += 2) {
    rows.push(
      shown.slice(index, index + 2).map((_, offset) => ({
        text: `✅ Подтвердить ${index + offset + 1}`,
        callback_data: pqConfirmCallback(index + offset),
      })),
    );
  }

  if (offers.length > 1) {
    rows.push([{ text: `✅ Подтвердить все (${offers.length})`, callback_data: PQ_CB_ALL }]);
  }

  return rows;
}

function formatPrice(value: number | undefined): string {
  if (value === undefined) return '—';
  return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
}
