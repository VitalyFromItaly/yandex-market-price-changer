import type { ITopSkusView } from './top-skus.domain';
import type { IProfitPlaceRow } from '../reports/profit';

import * as XLSX from 'xlsx';

import { TOP_SKUS_SCOPE_LABEL } from './top-skus.domain';

/**
 * «Топ товаров» файлом: ВСЕ проданные товары (в сообщение влезают первые 15), а при
 * разрезах по месту ещё листы «Регионы», «Кластеры» и «Товар × регион».
 *
 * Книга в памяти, на диск не пишется (довод report-workbook.ts). Числа — те же строки
 * `ITopSkusView`, что у сообщения: файл сходится с подписью по построению.
 */

const rub = (value: number): number => Math.round(value * 100) / 100;
const pct = (value: number | null): number | string =>
  value === null ? '' : Math.round(value * 1000) / 10;

function placeSheet(rows: IProfitPlaceRow[], title: string): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([
    [title, 'Штук', 'Продажи, ₽', 'Чистая, ₽'],
    ...rows.map((row) => [row.name, row.count, rub(row.revenue), rub(row.net)]),
  ]);
}

export function topSkusWorkbook(view: ITopSkusView): Buffer {
  const book = XLSX.utils.book_new();
  const sold = view.skus;

  const skus = XLSX.utils.aoa_to_sheet([
    [TOP_SKUS_SCOPE_LABEL[view.scope]],
    [
      'Место',
      'Артикул',
      'Товар',
      'Штук',
      'Продажи, ₽',
      'Чистая, ₽',
      'Маржа, %',
      'Возвраты, шт.',
      'Доля продаж, %',
    ],
    ...sold.map((row, index) => [
      index + 1,
      row.sku,
      row.name,
      row.count,
      rub(row.revenue),
      rub(row.net),
      pct(row.margin),
      row.returns,
      view.revenue ? Math.round((row.revenue / view.revenue) * 1000) / 10 : '',
    ]),
  ]);
  XLSX.utils.book_append_sheet(book, skus, 'Товары');

  if (view.byRegion) {
    XLSX.utils.book_append_sheet(book, placeSheet(view.byRegion, 'Регион'), 'Регионы');
  }
  if (view.byCluster) {
    XLSX.utils.book_append_sheet(book, placeSheet(view.byCluster, 'Кластер'), 'Кластеры');
  }
  if (view.byRegion) {
    const cross = XLSX.utils.aoa_to_sheet([
      ['Артикул', 'Товар', 'Регион', 'Штук', 'Продажи, ₽', 'Чистая, ₽'],
      ...sold.flatMap((row) =>
        (row.byRegion ?? []).map((place) => [
          row.sku,
          row.name,
          place.name,
          place.count,
          rub(place.revenue),
          rub(place.net),
        ]),
      ),
    ]);
    XLSX.utils.book_append_sheet(book, cross, 'Товар × регион');
  }

  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
