import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import {
  canonicalJournalIdentity,
  matchExistingOperations,
} from '../../src/modules/finance/ym-journal';
import {
  NettingFileError,
  YM_NETTING_COLUMNS,
  normalizeHeader,
  parseYmNettingFile,
} from '../../src/modules/finance/ym-netting-file';

/** Книга из массива строк: ячейки — как дала бы выгрузка (строки и числа, без Date). */
function xlsxOf(rows: unknown[][], sheet = 'Платежи'): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Серийная дата Excel для «16.09.2026 14:05» — время на часах, без пояса. */
const SERIAL_16_09_1405 = Date.UTC(2026, 8, 16, 14, 5) / 86_400_000 + 25569;

function failure(fn: () => unknown): NettingFileError {
  try {
    fn();
  } catch (error) {
    if (error instanceof NettingFileError) return error;
    throw error;
  }
  throw new Error('ожидался отказ разбора');
}

describe('словарь колонок', () => {
  it('один заголовок ведёт ровно в одно поле', () => {
    const owner = new Map<string, string>();
    for (const [field, column] of Object.entries(YM_NETTING_COLUMNS)) {
      for (const synonym of [field, ...column.synonyms]) {
        const key = normalizeHeader(synonym);
        expect(owner.get(key) ?? field, `«${synonym}»`).toBe(field);
        owner.set(key, field);
      }
    }
  });

  it('нормализация снимает регистр, ё, ₽ и «руб.», знаки и лишние пробелы', () => {
    expect(normalizeHeader('  Сумма транзакции, ₽ ')).toBe('сумма транзакции');
    expect(normalizeHeader('Сумма транзакции (руб.)')).toBe('сумма транзакции');
    expect(normalizeHeader('Номер платёжного поручения')).toBe('номер платежного поручения');
  });
});

describe('parseYmNettingFile', () => {
  it('xlsx с русскими заголовками под шапкой отчёта → строки в форме API', () => {
    const buffer = xlsxOf([
      ['Отчёт по платежам за сентябрь 2026'],
      [],
      [
        'Номер заказа',
        'Ваш SKU',
        'Название товара или услуги',
        'Тип транзакции',
        'Источник транзакции',
        'Дата транзакции',
        'Количество',
        'Сумма транзакции, ₽',
        'Номер платёжного поручения',
        'Дата платёжного поручения',
      ],
      [
        58841189889,
        'A1',
        'Часы',
        'Начисление',
        'Платёж покупателя',
        SERIAL_16_09_1405,
        1,
        1000,
        '',
        '',
      ],
      [
        '58841189890',
        12345,
        'Доставка покупателю',
        'Удержание',
        'Оплата услуг Маркета',
        '16.09.2026 14:05:59',
        '',
        '−1 234,50',
        'P-77',
        '20.09.2026',
      ],
      ['Итого', '', '', '', '', '', '', -234.5, '', ''],
    ]);

    const result = parseYmNettingFile(buffer, 'отчёт.xlsx');

    expect(result.headerRow).toBe(3);
    expect(result.rows).toEqual([
      {
        orderId: 58841189889,
        shopSku: 'A1',
        offerOrServiceName: 'Часы',
        transactionType: 'Начисление',
        transactionSource: 'Платёж покупателя',
        transactionDate: '16.09.2026 14:05',
        count: 1,
        transactionSum: 1000,
      },
      {
        orderId: 58841189890,
        shopSku: '12345',
        offerOrServiceName: 'Доставка покупателю',
        transactionType: 'Удержание',
        transactionSource: 'Оплата услуг Маркета',
        transactionDate: '16.09.2026 14:05',
        transactionSum: -1234.5,
        bankOrderId: 'P-77',
        bankOrderDate: '20.09.2026 00:00',
      },
    ]);
  });

  it('CSV с «;» в windows-1251 и camelCase-заголовками API', () => {
    const csv =
      'transactionDate;transactionSum;transactionType;transactionSource;orderId\r\n' +
      '05.10.2026 09:00;150,00;Начисление;Платёж покупателя;7\r\n';
    const cp1251 = Buffer.from(
      [...csv].map((ch) => {
        const code = ch.charCodeAt(0);
        // Кириллица А-я → 0xC0-0xFF, ё → 0xB8.
        if (code === 0x451) return 0xb8;
        return code >= 0x410 && code <= 0x44f ? code - 0x410 + 0xc0 : code;
      }),
    );

    const { rows } = parseYmNettingFile(cp1251, 'report.CSV');

    expect(rows).toEqual([
      {
        transactionDate: '05.10.2026 09:00',
        transactionSum: 150,
        transactionType: 'Начисление',
        transactionSource: 'Платёж покупателя',
        orderId: 7,
      },
    ]);
  });

  it('нет обязательных колонок — отказ с их перечнем', () => {
    const error = failure(() =>
      parseYmNettingFile(
        xlsxOf([
          ['Дата транзакции', 'Номер заказа'],
          ['16.09.2026 14:05', 1],
        ]),
        'a.xlsx',
      ),
    );
    expect(error.kind).toBe('unrecognized');
    expect(error.details.missing).toEqual([
      'Сумма транзакции',
      'Тип транзакции',
      'Источник транзакции',
    ]);
  });

  it('отчёт об услугах — свой отказ, а не перечень колонок', () => {
    const error = failure(() =>
      parseYmNettingFile(
        xlsxOf([
          ['Номер заказа', 'Название услуги', 'Дата оказания услуги'],
          [1, 'Доставка', '16.09.2026'],
        ]),
        'services.xlsx',
      ),
    );
    expect(error.kind).toBe('wrong-report');
  });

  it('битая дата — отказ с номером строки, а не тихий пропуск', () => {
    const error = failure(() =>
      parseYmNettingFile(
        xlsxOf([
          ['Дата транзакции', 'Сумма транзакции', 'Тип транзакции', 'Источник транзакции'],
          ['16.09.2026 14:05', 10, 'Начисление', 'Платёж покупателя'],
          ['31.02.2026 10:00', 10, 'Начисление', 'Платёж покупателя'],
        ]),
        'a.xlsx',
      ),
    );
    expect(error).toMatchObject({ kind: 'bad-row', details: { row: 3, field: 'Дата транзакции' } });
  });

  it('строка без суммы при заполненном типе — отказ', () => {
    const error = failure(() =>
      parseYmNettingFile(
        xlsxOf([
          ['Дата транзакции', 'Сумма транзакции', 'Тип транзакции', 'Источник транзакции'],
          ['16.09.2026 14:05', '', 'Начисление', 'Платёж покупателя'],
        ]),
        'a.xlsx',
      ),
    );
    expect(error).toMatchObject({ kind: 'bad-row', details: { row: 2 } });
  });

  it('одни заголовки — «нет операций»', () => {
    const error = failure(() =>
      parseYmNettingFile(
        xlsxOf([['Дата транзакции', 'Сумма транзакции', 'Тип транзакции', 'Источник транзакции']]),
        'a.xlsx',
      ),
    );
    expect(error.kind).toBe('empty');
  });
});

describe('канонический вид строки журнала', () => {
  const api = {
    orderId: 58841189889,
    shopSku: 'A1',
    offerOrServiceName: 'Часы',
    transactionType: 'Начисление',
    transactionSource: 'Платёж покупателя',
    transactionDate: '16.09.2026 14:05',
    actId: null,
    transactionSum: 1234.5,
    count: 1,
  };

  it('число и строка, «1 234,50» и 1234.5, пустое и null — одно и то же', () => {
    const file = {
      ...api,
      orderId: '58841189889',
      transactionSum: '1 234,50',
      count: '1',
      transactionDate: ' 16.09.2026 14:05 ',
    };
    delete (file as Record<string, unknown>).actId;
    expect(canonicalJournalIdentity(file)).toBe(canonicalJournalIdentity(api));
    expect(canonicalJournalIdentity({ ...api, transactionSum: 1234.51 })).not.toBe(
      canonicalJournalIdentity(api),
    );
  });

  it('одинаковые строки сопоставляются по одной; живые раньше снятых', () => {
    const existing = [
      { operationKey: 'dead', raw: api, superseded: true },
      { operationKey: 'k1', raw: api, superseded: false },
      { operationKey: 'k2', raw: api, superseded: false },
    ];
    const matches = matchExistingOperations(
      [api, { ...api, orderId: '58841189889' }, api, api],
      existing,
    );
    expect(matches).toEqual([
      { operationKey: 'k1', superseded: false },
      { operationKey: 'k2', superseded: false },
      { operationKey: 'dead', superseded: true },
      null,
    ]);
  });
});
