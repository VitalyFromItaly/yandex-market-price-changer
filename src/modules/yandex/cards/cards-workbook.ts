import type { IOfferCard } from './cards.domain';

import * as XLSX from 'xlsx';

import { MAX_EXPORT_ROWS } from '../reports/report-workbook';

import { cardStatusLabel, recommendationLabel } from './cards.domain';

/**
 * Выгрузка карточек в .xlsx. Книга собирается в Buffer и уходит в Telegram из
 * памяти — файл на диск не пишется (довод report-workbook).
 */

const HEADERS = [
  'Артикул',
  'Статус карточки',
  'Рейтинг, %',
  'Средний по категории, %',
  'Рекомендации',
  'Ошибки',
  'Предупреждения',
] as const;

export interface ICardsWorkbook {
  buffer: Buffer;
  rows: number;
  truncated: number;
}

export function buildCardsWorkbook(cards: readonly IOfferCard[]): ICardsWorkbook {
  // Худшие сверху — файл открывают ради них; карточки без рейтинга в конец.
  const sorted = [...cards].sort((a, b) => {
    if (a.contentRating === undefined && b.contentRating === undefined) {
      return a.offerId.localeCompare(b.offerId);
    }
    if (a.contentRating === undefined) return 1;
    if (b.contentRating === undefined) return -1;
    return a.contentRating - b.contentRating;
  });

  const exported = sorted.slice(0, MAX_EXPORT_ROWS);

  const rows: (string | number)[][] = [[...HEADERS]];
  for (const card of exported) {
    rows.push([
      card.offerId,
      cardStatusLabel(card.cardStatus),
      card.contentRating ?? '',
      card.averageContentRating ?? '',
      card.recommendations.map(recommendationLabel).join('; '),
      card.errorsCount || '',
      card.warningsCount || '',
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Карточки');

  return {
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rows: exported.length,
    truncated: sorted.length - exported.length,
  };
}
