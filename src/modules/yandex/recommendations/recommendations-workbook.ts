import type { IPriceRecommendation } from './recommendations.domain';

import * as XLSX from 'xlsx';

import { MAX_EXPORT_ROWS } from '../reports/report-workbook';

import {
  competitivenessLabel,
  recommendationDelta,
  sortByDeltaDesc,
} from './recommendations.domain';

/**
 * Выгрузка рекомендаций по ценам в .xlsx. Книга собирается в Buffer и уходит в
 * Telegram из памяти — файл на диск не пишется (довод report-workbook).
 */

const HEADERS = [
  'Артикул',
  'Цена, ₽',
  'Привлекательная до, ₽',
  'Умеренная до, ₽',
  'Дороже привлекательной, ₽',
  'Дороже привлекательной, %',
  'Оценка Маркета',
  'Показы за 7 дней',
] as const;

export interface IRecommendationsWorkbook {
  buffer: Buffer;
  rows: number;
  /** Сколько отброшено потолком строк. Ноль — выгружено всё. */
  truncated: number;
}

export function buildRecommendationsWorkbook(
  recommendations: readonly IPriceRecommendation[],
): IRecommendationsWorkbook {
  const sorted = sortByDeltaDesc(recommendations);
  const exported = sorted.slice(0, MAX_EXPORT_ROWS);

  const rows: (string | number)[][] = [[...HEADERS]];
  for (const row of exported) {
    const delta = recommendationDelta(row);
    rows.push([
      row.offerId,
      // Числа, а не строки «1 234 ₽»: продавцы считают выгрузку сводными.
      row.price ?? '',
      row.optimalPrice ?? '',
      row.averagePrice ?? '',
      delta ? round(delta.abs) : '',
      delta ? delta.percent : '',
      competitivenessLabel(row.competitiveness),
      row.shows ?? '',
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Рекомендации цен');

  return {
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rows: exported.length,
    truncated: sorted.length - exported.length,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
