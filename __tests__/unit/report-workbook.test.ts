import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import {
  MAX_EXPORT_ROWS,
  buildOrdersWorkbook,
  buildReturningWorkbook,
  formatItems,
  returningFileName,
  workbookFileName,
} from '../../src/modules/yandex/reports/report-workbook';
import type { IReportOrder } from '../../src/modules/yandex/reports/order-reports.service';
import type { IReturnRecord } from '../../src/modules/yandex/yandex-api.client';

/** Читает собранную книгу обратно — проверяем то, что реально увидит продавец. */
function readBack(buffer: Buffer): (string | number)[][] {
  const book = XLSX.read(buffer, { type: 'buffer' });
  const sheet = book.Sheets[book.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as never;
}

const ORDER = (over: Partial<IReportOrder> = {}): IReportOrder => ({
  id: 1,
  status: 'DELIVERY',
  creationDate: '28-07-2026',
  itemsTotal: 1000,
  deliveryTotal: 100,
  items: [{ offerName: 'Кроссовки', count: 2 }],
  ...over,
});

describe('Выгрузка .xlsx', () => {
  it('файл открывается и содержит шапку', () => {
    const { buffer } = buildOrdersWorkbook([ORDER()]);
    const rows = readBack(buffer);

    expect(rows[0]).toEqual([
      'Номер заказа',
      'Дата создания',
      'Статус',
      'Состав',
      'Сумма товаров, ₽',
      'Сумма с доставкой, ₽',
    ]);
  });

  it('строка — заказ, со всеми требуемыми колонками', () => {
    const { buffer } = buildOrdersWorkbook([ORDER({ id: 777 })]);
    const [, first] = readBack(buffer);

    expect(first[0]).toBe(777);
    expect(first[1]).toBe('28-07-2026');
    expect(first[2]).toBe('DELIVERY');
    expect(first[3]).toBe('Кроссовки ×2');
    expect(first[4]).toBe(1000);
    expect(first[5]).toBe(1100);
  });

  it('суммы лежат ЧИСЛАМИ, а не строками', () => {
    // «1 234 ₽» Excel сложить не сможет, а продавцы считают выгрузку сводными.
    const { buffer } = buildOrdersWorkbook([ORDER()]);
    const [, first] = readBack(buffer);

    expect(typeof first[4]).toBe('number');
    expect(typeof first[5]).toBe('number');
  });

  it('итоговая строка присутствует и суммирует всё', () => {
    const { buffer } = buildOrdersWorkbook([
      ORDER({ id: 1, itemsTotal: 1000, deliveryTotal: 100 }),
      ORDER({ id: 2, itemsTotal: 500, deliveryTotal: 50 }),
    ]);
    const rows = readBack(buffer);
    const total = rows[rows.length - 1];

    expect(total[0]).toBe('ИТОГО');
    expect(total[3]).toContain('2');
    expect(total[4]).toBe(1500);
    expect(total[5]).toBe(1650);
  });

  it('заказ без товаров и без сумм не роняет выгрузку', () => {
    const { buffer } = buildOrdersWorkbook([{ id: 5 }]);
    const [, first] = readBack(buffer);

    expect(first[3]).toBe('');
    expect(first[4]).toBe(0);
  });

  it('состав склеивается в одну ячейку', () => {
    expect(
      formatItems({
        items: [
          { offerName: 'Кроссовки', count: 2 },
          { offerName: 'Носки', count: 1 },
        ],
      }),
    ).toBe('Кроссовки ×2; Носки');
  });

  it('товар без названия не превращается в пустоту', () => {
    expect(formatItems({ items: [{ count: 1 }] })).toBe('без названия');
    expect(formatItems({ items: [{ offerName: '   ', count: 3 }] })).toBe('без названия ×3');
  });

  it('битый items не роняет разбор', () => {
    expect(formatItems({})).toBe('');
    expect(formatItems({ items: 'нет' as never })).toBe('');
  });
});

describe('Защита от переполнения', () => {
  it('большое количество заказов обрезается по потолку', () => {
    const orders = Array.from({ length: MAX_EXPORT_ROWS + 500 }, (_, i) =>
      ORDER({ id: i, items: [] }),
    );
    const result = buildOrdersWorkbook(orders);

    expect(result.rows).toBe(MAX_EXPORT_ROWS);
    expect(result.truncated).toBe(500);
  });

  it('обрезка ВИДНА вызывающему, а не происходит молча', () => {
    // Молча обрезанная выгрузка выглядит как полная — и расхождение с личным
    // кабинетом продавец обнаружит сам, в худший момент.
    const orders = Array.from({ length: 3 }, (_, i) => ORDER({ id: i }));
    expect(buildOrdersWorkbook(orders).truncated).toBe(0);
  });

  it('итог считается по тому, что реально попало в файл', () => {
    const orders = Array.from({ length: MAX_EXPORT_ROWS + 10 }, () =>
      ORDER({ itemsTotal: 1, deliveryTotal: 0, items: [] }),
    );
    const result = buildOrdersWorkbook(orders);
    const rows = readBack(result.buffer);

    expect(rows[rows.length - 1][4]).toBe(MAX_EXPORT_ROWS);
  });
});

describe('Временных файлов не существует', () => {
  it('сборка книги не пишет на диск', () => {
    // Прежний код терял временные файлы на УСПЕШНОМ пути: путь затирался
    // пустой строкой раньше удаления. Здесь файла нет вовсе — удалять нечего
    // ни при ошибке отправки, ни при падении процесса.
    const tempDir = join(process.cwd(), 'static', 'temp');
    const before = existsSync(tempDir) ? readdirSync(tempDir) : [];

    const { buffer } = buildOrdersWorkbook([ORDER(), ORDER({ id: 2 })]);

    const after = existsSync(tempDir) ? readdirSync(tempDir) : [];
    expect(after).toEqual(before);
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });

  it('имя файла содержит дату И время — в чате их накапливается много', () => {
    // Время не украшение: двух выгрузок за день хватает, чтобы файлы стали
    // неразличимы, а Telegram при совпадении содержимого отдаёт ранее
    // загруженный документ вместе с его старым именем.
    expect(workbookFileName('29-07-2026', '13:00')).toBe('edet-do-klienta-29-07-2026-1300.xlsx');
  });
});

const RETURN = (over: Partial<IReturnRecord> = {}): IReturnRecord => ({
  returnId: 10,
  orderId: 900,
  shipmentStatus: 'IN_TRANSIT',
  creationDate: '2026-07-28T12:00:00+03:00',
  items: [{ offerId: 'RET-1', count: 1 }],
  raw: {},
  ...over,
});

describe('Выгрузка «едет обратно» .xlsx', () => {
  it('файл открывается и содержит шапку с артикулом', () => {
    const { buffer } = buildReturningWorkbook([ORDER()], []);
    const rows = readBack(buffer);

    expect(rows[0]).toEqual([
      'Номер заказа',
      'Тип',
      'Дата',
      'Статус',
      'Артикул',
      'Товар',
      'Кол-во',
    ]);
  });

  it('строка — ПОЗИЦИЯ: заказ с двумя товарами даёт две строки с одним номером', () => {
    const order = ORDER({
      id: 777,
      substatus: 'RETURNED',
      items: [
        { offerId: 'SKU-1', offerName: 'Кроссовки', count: 2 },
        { offerId: 'SKU-2', offerName: 'Носки', count: 1 },
      ],
    });
    const { buffer } = buildReturningWorkbook([order], []);
    const [, first, second] = readBack(buffer);

    expect(first).toEqual([777, 'Невыкуп', '28-07-2026', 'RETURNED', 'SKU-1', 'Кроссовки', 2]);
    expect(second[0]).toBe(777);
    expect(second[4]).toBe('SKU-2');
  });

  it('строка возврата: тип «Возврат», артикул есть, названия нет', () => {
    // Метод возвратов названия товара не отдаёт — колонка «Товар» пустая,
    // а не подтянутая из Mongo: сервис отчётов остаётся API-only.
    const { buffer } = buildReturningWorkbook([], [RETURN({ orderId: 555 })]);
    const [, first] = readBack(buffer);

    expect(first[0]).toBe(555);
    expect(first[1]).toBe('Возврат');
    expect(first[3]).toBe('IN_TRANSIT');
    expect(first[4]).toBe('RET-1');
    expect(first[5]).toBe('');
    expect(first[6]).toBe(1);
  });

  it('заказ и возврат без позиций НЕ исчезают из файла', () => {
    // Они посчитаны в сообщении — файл обязан сходиться с ним по числу сущностей.
    const { buffer } = buildReturningWorkbook(
      [ORDER({ id: 1, items: [] })],
      [RETURN({ orderId: 2, items: undefined })],
    );
    const rows = readBack(buffer);

    expect(rows[1][0]).toBe(1);
    expect(rows[1][4]).toBe('');
    expect(rows[2][0]).toBe(2);
    expect(rows[2][4]).toBe('');
  });

  it('итоговая строка называет обе половины и суммирует количество', () => {
    const { buffer } = buildReturningWorkbook(
      [ORDER({ items: [{ offerId: 'A', count: 2 }] })],
      [RETURN({ orderId: 901, items: [{ offerId: 'B', count: 3 }] })],
    );
    const rows = readBack(buffer);
    const total = rows[rows.length - 1];

    expect(total[0]).toBe('ИТОГО');
    expect(total[5]).toBe('Невыкупов: 1 • Возвратов: 1');
    expect(total[6]).toBe(5);
  });

  it('потолок строк действует и обрезка видна вызывающему', () => {
    const orders = Array.from({ length: MAX_EXPORT_ROWS + 300 }, (_, i) =>
      ORDER({ id: i, items: [{ offerId: `S-${i}`, count: 1 }] }),
    );
    const result = buildReturningWorkbook(orders, []);

    expect(result.rows).toBe(MAX_EXPORT_ROWS);
    expect(result.truncated).toBe(300);
  });

  it('имя файла — edet-obratno с датой и временем', () => {
    expect(returningFileName('29-07-2026', '13:00')).toBe('edet-obratno-29-07-2026-1300.xlsx');
  });
});
