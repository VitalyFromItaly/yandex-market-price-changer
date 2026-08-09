import type { IPriceRecommendation } from './recommendations.domain';

import { b, code } from '../../telegram/formatting/telegram-format';
import { moscowStamp } from '../reports/moscow-day';

import { recommendationDelta, sortByDeltaDesc } from './recommendations.domain';

/**
 * Экран «🎯 Рекомендации цен» — единственный источник его текстов.
 *
 * Показывается сводка и топ худших; полная таблица — всегда в xlsx (довод FBY:
 * сотни строк не влезают в сообщение ни при каком пороге, а файл-по-условию
 * оставляет продавца гадать, почему файла нет именно сегодня).
 */

/** Сколько худших позиций печатать в сообщении. */
export const RECOMMENDATIONS_TOP_LIMIT = 10;

export function recommendationsQueuedText(): string {
  return '⏳ Собираю рекомендации Маркета по ценам, пришлю, как будут готовы…';
}

export function recommendationsQueuedAlreadyText(): string {
  return '⏳ Рекомендации по ценам уже собираются, подождите немного.';
}

export function recommendationsErrorText(): string {
  return '❌ Не удалось получить рекомендации по ценам. Попробуйте позже.';
}

export function recommendationsEmptyText(): string {
  return '🎯 Все цены привлекательные — Маркету предложить нечего.';
}

/**
 * Текст экрана: момент среза, счётчики по привлекательности и топ худших.
 *
 * Момент среза обязателен: это снапшот, и без времени его нечем сверить с
 * кабинетом (довод «Едет до клиента»).
 */
export function recommendationsText(
  rows: readonly IPriceRecommendation[],
  now: Date = new Date(),
): string {
  const average = rows.filter((row) => row.competitiveness === 'AVERAGE').length;
  const low = rows.filter((row) => row.competitiveness === 'LOW').length;
  const other = rows.length - average - low;

  const lines: string[] = [
    `🎯 ${b('Рекомендации Маркета по ценам')} — на ${moscowStamp(now)} МСК`,
    '',
    `Товаров с непривлекательной ценой: ${b(rows.length)}`,
    `• умеренная цена: ${average}`,
    `• непривлекательная: ${low}`,
  ];
  if (other > 0) lines.push(`• прочие: ${other}`);

  lines.push('', b(`Сильнее всего выше привлекательной (топ-${RECOMMENDATIONS_TOP_LIMIT}):`));

  const top = sortByDeltaDesc(rows).slice(0, RECOMMENDATIONS_TOP_LIMIT);
  let printed = 0;
  for (const row of top) {
    const delta = recommendationDelta(row);
    if (!delta) continue;
    printed += 1;
    const shows = row.shows !== undefined ? `, показы за 7 дн: ${row.shows}` : '';
    lines.push(
      `${printed}. ${code(row.offerId)} — ${formatRub(row.price)} при привлекательной ` +
        `до ${formatRub(row.optimalPrice)} (дороже на ${formatRub(delta.abs)}, ` +
        `${delta.percent}%${shows})`,
    );
  }
  if (printed === 0) {
    lines.push('Для этих товаров Маркет не назвал порог цены — см. файл.');
  }

  lines.push('', 'Полная таблица — в приложенном файле.');
  return lines.join('\n');
}

export function recommendationsFileName(now: Date = new Date()): string {
  const stamp = moscowStamp(now).replace(' ', '-').replace(':', '');
  return `rekomendacii-cen-${stamp}.xlsx`;
}

function formatRub(value: number | undefined): string {
  if (value === undefined) return '—';
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(value * 100) / 100)} ₽`;
}
