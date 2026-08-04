import * as XLSX from 'xlsx';
import { orderTotals } from './money';
import type { IReturnRecord } from '../yandex-api.client';
import type { IReportOrder } from './order-reports.service';

/**
 * Выгрузка отчёта в .xlsx.
 *
 * ФАЙЛ НА ДИСК НЕ ПИШЕТСЯ. Книга собирается в Buffer и уходит в Telegram прямо
 * из памяти. Это не оптимизация, а устранение целого класса дефектов: в прежнем
 * коде временные файлы утекали на успешном пути (путь затирался пустой строкой
 * до удаления), и «удалять в finally» — лишь лечение симптома. Нет файла — нет
 * и утечки, ни при ошибке отправки, ни при падении процесса.
 */

/**
 * Потолок строк. Telegram принимает от бота документ до 50 МБ, но проблема
 * возникает раньше: книга целиком лежит в памяти. 20 000 строк — это заведомо
 * безопасные единицы мегабайт.
 */
export const MAX_EXPORT_ROWS = 20_000;

const HEADERS = [
  'Номер заказа',
  'Дата создания',
  'Статус',
  'Состав',
  'Сумма товаров, ₽',
  'Сумма с доставкой, ₽',
] as const;

export interface IWorkbookResult {
  buffer: Buffer;
  /** Сколько заказов реально попало в файл. */
  rows: number;
  /** Сколько отброшено потолком. Ноль — значит выгружено всё. */
  truncated: number;
}

/** Состав заказа одной строкой: «Кроссовки ×2; Носки ×3». */
export function formatItems(order: IReportOrder): string {
  const items = order?.items;
  if (!Array.isArray(items) || !items.length) return '';

  return items
    .map((item) => {
      const name = (item?.offerName ?? '').trim() || 'без названия';
      const count = Number(item?.count);
      return Number.isFinite(count) && count > 1 ? `${name} ×${count}` : name;
    })
    .join('; ');
}

export function buildOrdersWorkbook(orders: readonly IReportOrder[]): IWorkbookResult {
  const exported = orders.slice(0, MAX_EXPORT_ROWS);
  const truncated = orders.length - exported.length;

  const rows: (string | number)[][] = [[...HEADERS]];
  let totalItems = 0;
  let totalWithDelivery = 0;

  for (const order of exported) {
    const totals = orderTotals(order);
    totalItems += totals.items;
    totalWithDelivery += totals.withDelivery;

    rows.push([
      order?.id ?? '',
      formatCreationDate(order?.creationDate),
      order?.status ?? '',
      formatItems(order),
      // В ячейку кладём ЧИСЛО, а не отформатированную строку: «1 234 ₽» Excel
      // сложить не сможет, а продавцы считают выгрузку сводными таблицами.
      round(totals.items),
      round(totals.withDelivery),
    ]);
  }

  rows.push([]);
  rows.push([
    'ИТОГО',
    '',
    '',
    `Заказов: ${exported.length}`,
    round(totalItems),
    round(totalWithDelivery),
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 50 }, { wch: 18 }, { wch: 20 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Заказы');

  return {
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rows: exported.length,
    truncated,
  };
}

/**
 * Имя файла с датой И временем — в чате их накапливается много.
 *
 * Время не украшение: двух выгрузок за день достаточно, чтобы файлы стали
 * неразличимы, а Telegram при совпадении содержимого отдаёт РАНЕЕ загруженный
 * документ вместе с его старым именем — и свежая выгрузка выглядит вчерашней.
 * Момент в имени (и такой же в подписи) снимает этот вопрос сразу.
 */
export function workbookFileName(dateParam: string, timeParam: string): string {
  return `edet-do-klienta-${dateParam}-${timeParam.replace(':', '')}.xlsx`;
}

const RETURNING_HEADERS = [
  'Номер заказа',
  'Тип',
  'Дата',
  'Статус',
  'Артикул',
  'Товар',
  'Кол-во',
] as const;

/**
 * Книга «Едет обратно»: СТРОКА НА ПОЗИЦИЮ, не на заказ — артикулы и есть смысл
 * этой выгрузки, а склеенные в одну ячейку они не фильтруются и не сводятся.
 *
 * Денежных колонок нет нарочно: у позиции возврата своей суммы не бывает, а
 * сумма заказа, повторённая на каждой его строке, задваивается в сводных
 * таблицах. Деньги уже есть в подписи к файлу.
 *
 * В строках возвратов «Товар» пуст: метод возвратов отдаёт только артикул, а
 * тянуть названия из нашей базы значило бы пришить Mongo к API-only сервису.
 */
export function buildReturningWorkbook(
  orders: readonly IReportOrder[],
  returns: readonly IReturnRecord[],
): IWorkbookResult {
  const all: (string | number)[][] = [];

  for (const order of orders) {
    const base = [
      order?.id ?? '',
      'Невыкуп',
      formatCreationDate(order?.creationDate),
      order?.substatus ?? order?.status ?? '',
    ];
    appendItemRows(all, base, order?.items);
  }

  for (const record of returns) {
    const base = [
      record?.orderId ?? '',
      'Возврат',
      formatCreationDate(record?.creationDate),
      record?.shipmentStatus ?? '',
    ];
    appendItemRows(all, base, record?.items);
  }

  const exported = all.slice(0, MAX_EXPORT_ROWS);
  const truncated = all.length - exported.length;

  let totalCount = 0;
  for (const row of exported) {
    const count = Number(row[6]);
    if (Number.isFinite(count)) totalCount += count;
  }

  const rows: (string | number)[][] = [[...RETURNING_HEADERS], ...exported];
  rows.push([]);
  rows.push([
    'ИТОГО',
    '',
    '',
    '',
    '',
    `Невыкупов: ${orders.length} • Возвратов: ${returns.length}`,
    totalCount,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 14 },
    { wch: 10 },
    { wch: 12 },
    { wch: 24 },
    { wch: 20 },
    { wch: 40 },
    { wch: 8 },
  ];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Едет обратно');

  return {
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rows: exported.length,
    truncated,
  };
}

/**
 * Строки позиций одной сущности. Заказ или возврат БЕЗ позиций не исчезает —
 * он посчитан в сообщении, значит обязан быть и в файле: одна строка с пустыми
 * артикулом и количеством.
 */
function appendItemRows(
  rows: (string | number)[][],
  base: (string | number)[],
  items: { offerId?: string; offerName?: string; count?: number }[] | undefined,
): void {
  if (!Array.isArray(items) || !items.length) {
    rows.push([...base, '', '', '']);
    return;
  }

  for (const item of items) {
    const count = Number(item?.count);
    rows.push([
      ...base,
      item?.offerId ?? '',
      item?.offerName ?? '',
      Number.isFinite(count) ? count : '',
    ]);
  }
}

/** Имя файла «едет обратно» — дата и время по той же причине, что выше. */
export function returningFileName(dateParam: string, timeParam: string): string {
  return `edet-obratno-${dateParam}-${timeParam.replace(':', '')}.xlsx`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Дата создания приходит как ISO или как DD-MM-YYYY — показываем как есть. */
function formatCreationDate(value: string | undefined): string {
  return (value ?? '').trim();
}
