import type { ICardsSummary } from './cards.domain';

import { b, code, esc } from '../../telegram/formatting/telegram-format';
import { moscowStamp } from '../reports/moscow-day';

import { cardStatusLabel, recommendationLabel } from './cards.domain';

/**
 * Экран «🪪 Карточки» — единственный источник его текстов (правило «один
 * экран — один текст»). Полная таблица — всегда в xlsx (довод FBY).
 */

/** Сколько рекомендаций печатать под одной слабой карточкой. */
const RECOMMENDATIONS_PER_CARD = 3;

export function cardsQueuedText(): string {
  return '⏳ Собираю сводку по карточкам, пришлю, как будет готова…';
}

export function cardsQueuedAlreadyText(): string {
  return '⏳ Сводка по карточкам уже собирается, подождите немного.';
}

export function cardsErrorText(): string {
  return '❌ Не удалось собрать сводку по карточкам. Попробуйте позже.';
}

export function cardsEmptyText(): string {
  return '🪪 Маркет не вернул ни одной карточки — каталог пуст.';
}

/**
 * Текст экрана: момент среза (снапшот — довод «Едет до клиента»), статусы
 * (сначала требующие действия), рейтинг против категорийного ориентира и
 * слабые карточки с рекомендациями по-русски.
 */
export function cardsText(summary: ICardsSummary, now: Date = new Date()): string {
  const lines: string[] = [
    `🪪 ${b('Карточки товаров')} — на ${moscowStamp(now)} МСК`,
    '',
    `Всего карточек: ${b(summary.totalCards)}`,
  ];

  for (const row of summary.byStatus) {
    lines.push(`• ${esc(cardStatusLabel(row.status))}: ${row.count}`);
  }

  if (summary.averageRating !== null) {
    const benchmark =
      summary.averageBenchmark !== null
        ? ` · в среднем по категориям у всех продавцов: ${b(`${summary.averageBenchmark}%`)}`
        : '';
    lines.push('', `Средний рейтинг заполненности: ${b(`${summary.averageRating}%`)}${benchmark}`);
  }

  if (summary.worst.length) {
    lines.push('', b('🔻 Самые слабые карточки:'));
    summary.worst.forEach((card, index) => {
      const rating = card.contentRating !== undefined ? ` — ${card.contentRating}%` : '';
      lines.push(`${index + 1}. ${code(card.offerId)}${rating}`);
      for (const rec of card.recommendations.slice(0, RECOMMENDATIONS_PER_CARD)) {
        lines.push(`   · ${esc(recommendationLabel(rec))}`);
      }
    });
  }

  lines.push('', 'Полная таблица — в приложенном файле.');
  return lines.join('\n');
}

export function cardsFileName(now: Date = new Date()): string {
  const stamp = moscowStamp(now).replace(' ', '-').replace(':', '');
  return `kartochki-${stamp}.xlsx`;
}
