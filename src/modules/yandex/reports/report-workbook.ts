import * as XLSX from 'xlsx';
import { orderTotals } from './money';
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Дата создания приходит как ISO или как DD-MM-YYYY — показываем как есть. */
function formatCreationDate(value: string | undefined): string {
  return (value ?? '').trim();
}
