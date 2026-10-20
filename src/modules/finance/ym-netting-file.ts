/**
 * Ручная загрузка журнала ЯМ (TASK-114): файл united-netting из кабинета (xlsx,
 * xls, csv) → строки в форме JSON-отчёта API (camelCase-поля, даты
 * «ДД.ММ.ГГГГ ЧЧ:ММ», суммы числом). Дальше строки идут тем же путём, что у
 * импорта: `nettingRowToOperation`, классификатор, upsert.
 *
 * Раскладка колонок не фиксирована — колонка находится по заголовку из словаря
 * синонимов (`YM_NETTING_COLUMNS`). Настоящего файла кабинета у нас нет (решение
 * `finance_upload_no_sample`): синонимы — camelCase-имена API плюс
 * предполагаемые русские подписи; сверка на живом файле — known-gaps.
 *
 * Чистый модуль: Nest и базы не знает.
 */

import * as XLSX from 'xlsx';

import { toKopecks } from './kopecks';

type TRow = Record<string, unknown>;

export type TNettingField =
  | 'orderId'
  | 'shopSku'
  | 'offerOrServiceName'
  | 'transactionType'
  | 'transactionSource'
  | 'transactionDate'
  | 'actId'
  | 'actDate'
  | 'transactionSum'
  | 'count'
  | 'model'
  | 'paymentStatus'
  | 'bankOrderId'
  | 'bankOrderDate'
  | 'bankSum'
  | 'vatRate';

type TValueKind = 'text' | 'id' | 'money' | 'count' | 'dateTime' | 'date';

interface INettingColumn {
  /** Подпись для отказа «не нашли колонки». */
  label: string;
  kind: TValueKind;
  /** Заголовки, которыми колонка может называться (сравниваются после `normalizeHeader`). */
  synonyms: readonly string[];
}

/**
 * Словарь колонок. `Record` по полю, а не список: новое поле не скомпилируется
 * без решения, как его искать и разбирать (довод `DRAFT_FIELD_SET`).
 *
 * `id` — номер, который в JSON Маркета, вероятнее всего, число (orderId в
 * тестовых строках TASK-111 — число). Ключ всё равно не зависит от угадки:
 * сопоставление идёт по каноническому виду (`matchExistingOperations`).
 */
export const YM_NETTING_COLUMNS: Record<TNettingField, INettingColumn> = {
  orderId: { label: 'Номер заказа', kind: 'id', synonyms: ['Номер заказа', 'ID заказа', 'Заказ'] },
  shopSku: {
    label: 'Ваш SKU',
    kind: 'text',
    synonyms: ['Ваш SKU', 'SKU', 'SKU продавца', 'Ваш артикул', 'Артикул', 'Артикул продавца'],
  },
  offerOrServiceName: {
    label: 'Название товара или услуги',
    kind: 'text',
    synonyms: [
      'Название товара или услуги',
      'Товар или услуга',
      'Название товара',
      'Наименование товара или услуги',
      'Услуга',
    ],
  },
  transactionType: {
    label: 'Тип транзакции',
    kind: 'text',
    synonyms: ['Тип транзакции', 'Тип операции'],
  },
  transactionSource: {
    label: 'Источник транзакции',
    kind: 'text',
    synonyms: ['Источник транзакции', 'Источник операции', 'Источник', 'Описание транзакции'],
  },
  transactionDate: {
    label: 'Дата транзакции',
    kind: 'dateTime',
    synonyms: [
      'Дата транзакции',
      'Дата и время транзакции',
      'Дата операции',
      'Дата и время операции',
    ],
  },
  actId: { label: 'Номер акта', kind: 'id', synonyms: ['Номер акта', 'Акт', 'ID акта'] },
  actDate: { label: 'Дата акта', kind: 'date', synonyms: ['Дата акта'] },
  transactionSum: {
    label: 'Сумма транзакции',
    kind: 'money',
    synonyms: ['Сумма транзакции', 'Сумма операции', 'Сумма'],
  },
  count: {
    label: 'Количество',
    kind: 'count',
    synonyms: ['Количество', 'Кол-во', 'Количество шт', 'Количество товаров'],
  },
  model: {
    label: 'Модель работы',
    kind: 'text',
    synonyms: ['Модель работы', 'Модель', 'Схема работы'],
  },
  paymentStatus: {
    label: 'Статус платежа',
    kind: 'text',
    synonyms: ['Статус платежа', 'Статус выплаты', 'Статус перевода', 'Статус'],
  },
  bankOrderId: {
    label: 'Номер платёжного поручения',
    kind: 'id',
    synonyms: ['Номер платёжного поручения', 'Платёжное поручение', 'Номер поручения'],
  },
  bankOrderDate: {
    label: 'Дата платёжного поручения',
    kind: 'dateTime',
    synonyms: ['Дата платёжного поручения', 'Дата поручения', 'Дата выплаты'],
  },
  bankSum: {
    label: 'Сумма платёжного поручения',
    kind: 'money',
    synonyms: ['Сумма платёжного поручения', 'Сумма поручения', 'Сумма выплаты'],
  },
  vatRate: { label: 'Ставка НДС', kind: 'text', synonyms: ['Ставка НДС', 'НДС'] },
};

/** Без них строку не классифицировать и не записать (`nettingRowToOperation`, `classifyYmRow`). */
export const YM_NETTING_REQUIRED: readonly TNettingField[] = [
  'transactionDate',
  'transactionSum',
  'transactionType',
  'transactionSource',
];

/**
 * Заголовки отчёта об услугах (united-marketplace-services). Его строки —
 * расшифровка тех же удержаний (Σ services = −Σ netting), и в журнале услуги
 * посчитались бы дважды (решение `finance_upload_netting_only`). Узнаём, чтобы
 * отказать понятно, а не перечнем «не нашли колонки».
 */
const SERVICES_MARKERS = [
  'serviceName',
  'serviceDateTime',
  'serviceDate',
  'Название услуги',
  'Дата оказания услуги',
  'Дата и время оказания услуги',
];

/** Сколько первых строк листа просматривать в поиске заголовка: над таблицей бывает шапка отчёта. */
const HEADER_SCAN_ROWS = 30;

export type TNettingFileErrorKind =
  | 'unreadable'
  | 'empty'
  | 'unrecognized'
  | 'wrong-report'
  | 'bad-row';

/** Отказ разбора — с тем, что продавцу показать и что исправить. */
export class NettingFileError extends Error {
  constructor(
    readonly kind: TNettingFileErrorKind,
    message: string,
    readonly details: { missing?: string[]; row?: number; field?: string } = {},
  ) {
    super(message);
    this.name = 'NettingFileError';
  }
}

export interface INettingFileResult {
  rows: TRow[];
  sheet: string;
  /** Номер строки заголовка в листе, с 1 — как видит продавец. */
  headerRow: number;
  /** Найденные колонки — для журнала и для теста словаря. */
  fields: TNettingField[];
}

/**
 * Заголовок → форма для сравнения: регистр, ё→е, «₽»/«руб.», кавычки и знаки
 * препинания, пробелы (и неразрывные) — Excel и кабинет пишут одно и то же
 * по-разному, а различия эти ничего не значат.
 */
export function normalizeHeader(value: unknown): string {
  return (
    String(value ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[«»"'`.,:;()[\]₽]/g, ' ')
      // Не `\bруб\b`: в JS \b — граница ASCII-слова, перед кириллицей не срабатывает.
      .replace(/(^|\s)руб(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Синоним → поле. Один заголовок обязан вести ровно в одно поле — пиннится тестом. */
export function headerIndex(): Map<string, TNettingField> {
  const index = new Map<string, TNettingField>();
  for (const [field, column] of Object.entries(YM_NETTING_COLUMNS) as [
    TNettingField,
    INettingColumn,
  ][]) {
    for (const synonym of [field, ...column.synonyms]) index.set(normalizeHeader(synonym), field);
  }
  return index;
}

/**
 * Файл united-netting → строки в форме API.
 *
 * Ищется лист и строка заголовка, где узнано больше всего колонок. Нет
 * обязательных — отказ с их перечнем; похоже на отчёт об услугах — свой отказ.
 * Строка с битой датой или суммой — отказ с номером строки: тихо пропущенная
 * операция — это занижение статьи, которого никто не заметит.
 */
export function parseYmNettingFile(buffer: Buffer, fileName: string): INettingFileResult {
  const workbook = readWorkbook(buffer, fileName);
  const index = headerIndex();
  const servicesMarkers = new Set(SERVICES_MARKERS.map(normalizeHeader));

  let best: {
    sheet: string;
    row: number;
    columns: Map<number, TNettingField>;
    data: unknown[][];
  } | null = null;
  let sawServices = false;
  for (const sheet of workbook.SheetNames) {
    const data = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], {
      header: 1,
      raw: true,
      defval: '',
      blankrows: true,
    });
    for (let r = 0; r < Math.min(data.length, HEADER_SCAN_ROWS); r++) {
      const columns = new Map<number, TNettingField>();
      const taken = new Set<TNettingField>();
      (data[r] ?? []).forEach((cell, c) => {
        const normalized = normalizeHeader(cell);
        if (servicesMarkers.has(normalized)) sawServices = true;
        const field = index.get(normalized);
        // Первая колонка с этим заголовком — та, что нужна; повтор не перетирает.
        if (field && !taken.has(field)) {
          columns.set(c, field);
          taken.add(field);
        }
      });
      if (columns.size && (!best || columns.size > best.columns.size)) {
        best = { sheet, row: r, columns, data };
      }
    }
  }

  const found = new Set(best?.columns.values() ?? []);
  const missing = YM_NETTING_REQUIRED.filter((f) => !found.has(f));
  if (!best || missing.length) {
    if (sawServices) {
      throw new NettingFileError(
        'wrong-report',
        'Это отчёт об услугах Маркета — расшифровка удержаний, они уже есть в отчёте по платежам. ' +
          'Загрузите отчёт по платежам (united-netting).',
      );
    }
    const labels = missing.map((f) => YM_NETTING_COLUMNS[f].label);
    throw new NettingFileError(
      'unrecognized',
      `Не похоже на отчёт Маркета по платежам: не нашли колонки ${labels.map((l) => `«${l}»`).join(', ')}.`,
      { missing: labels },
    );
  }

  const rows: TRow[] = [];
  for (let r = best.row + 1; r < best.data.length; r++) {
    const cells = best.data[r] ?? [];
    const row: TRow = {};
    for (const [c, field] of best.columns) {
      const value = convertCell(cells[c], YM_NETTING_COLUMNS[field].kind);
      if (value === undefined) continue;
      if (value === INVALID) {
        throw new NettingFileError(
          'bad-row',
          `Строка ${r + 1}: не разобрали «${YM_NETTING_COLUMNS[field].label}» (${String(cells[c])}).`,
          { row: r + 1, field: YM_NETTING_COLUMNS[field].label },
        );
      }
      row[field] = value;
    }
    const present = YM_NETTING_REQUIRED.filter((f) => row[f] !== undefined);
    // Пустая строка и подвал «Итого» без типа и даты — не операции.
    if (!present.length || (row.transactionType === undefined && row.transactionDate === undefined))
      continue;
    if (present.length < YM_NETTING_REQUIRED.length) {
      const absent = YM_NETTING_REQUIRED.filter((f) => row[f] === undefined).map(
        (f) => YM_NETTING_COLUMNS[f].label,
      );
      throw new NettingFileError(
        'bad-row',
        `Строка ${r + 1}: пусто в ${absent.map((l) => `«${l}»`).join(', ')}.`,
        {
          row: r + 1,
          field: absent[0],
        },
      );
    }
    rows.push(row);
  }

  if (!rows.length) {
    throw new NettingFileError('empty', 'В файле нет ни одной операции.');
  }
  return { rows, sheet: best.sheet, headerRow: best.row + 1, fields: [...best.columns.values()] };
}

function readWorkbook(buffer: Buffer, fileName: string): XLSX.WorkBook {
  try {
    if (/\.csv$/i.test(fileName)) {
      // raw: значения CSV остаются текстом — иначе SheetJS сам угадывает даты, и
      // «05.10» легко становится маем. Кабинет может отдать CSV в windows-1251.
      return XLSX.read(decodeCsv(buffer), { type: 'string', raw: true });
    }
    return XLSX.read(buffer, { type: 'buffer' });
  } catch (error) {
    throw new NettingFileError(
      'unreadable',
      `Не удалось прочитать файл: ${(error as Error).message}`,
    );
  }
}

/** UTF-8 (с BOM или без), иначе windows-1251. */
function decodeCsv(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1251').decode(buffer);
  }
}

const INVALID = Symbol('invalid');

function convertCell(value: unknown, kind: TValueKind): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  switch (kind) {
    case 'text':
      return typeof value === 'string' ? value.trim() : String(value);
    case 'id':
      return idValue(value);
    case 'money': {
      const kopecks = toKopecks(value);
      return kopecks === null ? INVALID : kopecks / 100;
    }
    case 'count': {
      const n = Number(typeof value === 'string' ? value.trim().replace(',', '.') : value);
      return Number.isFinite(n) ? n : INVALID;
    }
    case 'dateTime':
      return dateValue(value, true) ?? INVALID;
    case 'date':
      return dateValue(value, false) ?? INVALID;
  }
}

/** Номер из цифр — числом (вероятная форма JSON Маркета), иначе текстом как есть. */
function idValue(value: unknown): unknown {
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  if (/^\d+$/.test(text) && Number.isSafeInteger(Number(text))) return Number(text);
  return text;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Ячейка даты → «ДД.ММ.ГГГГ ЧЧ:ММ» (или «ДД.ММ.ГГГГ») — форма JSON Маркета.
 * Число — серийная дата Excel: это время на часах, как его видит продавец, то
 * есть московское, и переводить пояса не нужно. Секунды отбрасываются — у API
 * их нет. Строка с поясом (ISO) переводится в Москву.
 */
function dateValue(value: unknown, withTime: boolean): string | null {
  let parts: { d: number; m: number; y: number; hh: number; mm: number } | null = null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = Math.round((value - 25569) * 86400) * 1000;
    const date = new Date(ms);
    parts = {
      d: date.getUTCDate(),
      m: date.getUTCMonth() + 1,
      y: date.getUTCFullYear(),
      hh: date.getUTCHours(),
      mm: date.getUTCMinutes(),
    };
  } else if (typeof value === 'string') {
    parts = parseDateText(value.trim());
  } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
    parts = mskParts(value);
  }
  if (!parts || !validParts(parts)) return null;
  const day = `${pad(parts.d)}.${pad(parts.m)}.${parts.y}`;
  return withTime ? `${day} ${pad(parts.hh)}:${pad(parts.mm)}` : day;
}

function parseDateText(text: string) {
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(
    text,
  );
  if (ru) {
    return { d: +ru[1], m: +ru[2], y: +ru[3], hh: ru[4] ? +ru[4] : 0, mm: ru[5] ? +ru[5] : 0 };
  }
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      text,
    );
  if (!iso) return null;
  if (iso[6]) {
    const date = new Date(text.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : mskParts(date);
  }
  return { d: +iso[3], m: +iso[2], y: +iso[1], hh: iso[4] ? +iso[4] : 0, mm: iso[5] ? +iso[5] : 0 };
}

/** Момент → часы в Москве (фиксированные +03:00, как в ym-journal). */
function mskParts(date: Date) {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return {
    d: msk.getUTCDate(),
    m: msk.getUTCMonth() + 1,
    y: msk.getUTCFullYear(),
    hh: msk.getUTCHours(),
    mm: msk.getUTCMinutes(),
  };
}

function validParts(p: { d: number; m: number; y: number; hh: number; mm: number }): boolean {
  if (p.y < 2000 || p.y > 2100 || p.m < 1 || p.m > 12 || p.hh > 23 || p.mm > 59) return false;
  const check = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return check.getUTCDate() === p.d && check.getUTCMonth() === p.m - 1;
}
