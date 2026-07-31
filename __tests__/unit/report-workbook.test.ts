import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import {
  MAX_EXPORT_ROWS,
  buildOrdersWorkbook,
  formatItems,
  workbookFileName,
} from '../../src/modules/yandex/reports/report-workbook';
import type { IReportOrder } from '../../src/modules/yandex/reports/order-reports.service';

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
