import * as XLSX from 'xlsx';

/**
 * Разбор прайс-листа поставщика.
 *
 * Формат подтверждён на живом файле «Прайс 29.07.26.xlsx» (фикстура
 * __tests__/fixtures/price-template.xlsx): 4349 товарных строк.
 */

/** Раскладка колонок. Индексы, а не буквы — sheet_to_json отдаёт массивы. */
export const PRICE_LAYOUT = {
  sheet: 'TDSheet',
  /** Строка шапки: «Наименование | Цена | Количество | Заказ». */
  headerRow: 7,
  /** Данные начинаются со строки 9 (шапка, затем заголовок первой категории). */
  firstDataRow: 9,
  columns: {
    name: 1, // B
    price: 4, // E
    quantity: 6, // G — остаток, который проставляем
  },
} as const;

export interface IPriceRow {
  /** Наименование как в файле, без изменений. */
  name: string;
  /** Категория из строки-заголовка выше. Нужна только для отчёта. */
  category: string;
  price: number | null;
  /** Остаток. 0 — валидное значение, означает «нет в наличии». */
  quantity: number;
  /** Номер строки в файле — чтобы в отчёте об ошибке было куда смотреть. */
  rowNumber: number;
}

export interface IParseResult {
  rows: IPriceRow[];
  /** Строки, которые не удалось разобрать: пустое имя, нечисловой остаток. */
  invalid: Array<{ rowNumber: number; name: string; reason: string }>;
}

/**
 * Строки-заголовки категорий: колонка A заполнена, B пуста. В файле их 18
 * («ORIENT механические», «CASIO COLLECTION», …). Их надо не пропускать
 * молча, а запоминать — категория попадёт в отчёт.
 */
function isCategoryHeader(row: unknown[]): boolean {
  const a = String(row[0] ?? '').trim();
  const b = String(row[PRICE_LAYOUT.columns.name] ?? '').trim();
  return Boolean(a) && !b;
}

/**
 * Числа приходят строками вида «18 800» — с пробелом-разделителем разрядов,
 * иногда неразрывным. Обычный parseFloat на таком вернёт 18.
 */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  const text = String(raw ?? '')
    .replace(/\u00A0/g, '') // неразрывный пробел — Excel отдаёт именно его
    .replace(/\s/g, '')
    .replace(',', '.')
    .trim();

  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Остаток бывает не числом, а порогом: «>10» значит «больше десяти, точное
 * количество не считали».
 *
 * ЭТО МЕСТО УЖЕ СТОИЛО БЫ ДОРОГО. Прежний парсер знал единственный частный
 * случай — строку ровно «>5», которую превращал в 6. Всё остальное уходило в
 * Number('>10') → NaN → **0**. В присланном прайсе порогов «>10» ровно 1605
 * штук, то есть 37 % позиций: старая логика обнулила бы им остаток на
 * Маркете — молча, без единой ошибки в отчёте.
 *
 * Правило теперь общее: «>N» превращается в N+1 — минимальное количество, при
 * котором утверждение «больше N» истинно. Занижение безопаснее завышения:
 * лучше недопродать, чем принять заказ на товар, которого нет.
 */
export function parseQuantity(raw: unknown): number | null {
  const text = String(raw ?? '').trim();

  const above = text.match(/^>\s*(\d+)$/);
  if (above) return Number(above[1]) + 1;

  // «<N» — порог сверху: точное количество неизвестно, берём нижнюю границу.
  const below = text.match(/^<\s*(\d+)$/);
  if (below) return Math.max(0, Number(below[1]) - 1);

  return parseNumber(raw);
}

export function parsePriceList(buffer: Buffer): IParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const sheetName = workbook.SheetNames.includes(PRICE_LAYOUT.sheet)
    ? PRICE_LAYOUT.sheet
    : workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error('В файле нет ни одного листа');
  }

  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  });

  const rows: IPriceRow[] = [];
  const invalid: IParseResult['invalid'] = [];
  let category = '(без категории)';

  // firstDataRow — номер строки для человека, в массиве индексация с нуля.
  for (let i = PRICE_LAYOUT.firstDataRow - 1; i < raw.length; i += 1) {
    const row = raw[i] ?? [];
    const rowNumber = i + 1;

    if (isCategoryHeader(row)) {
      category = String(row[0]).trim();
      continue;
    }

    const name = String(row[PRICE_LAYOUT.columns.name] ?? '').trim();
    if (!name) continue; // пустая строка-разделитель

    const quantity = parseQuantity(row[PRICE_LAYOUT.columns.quantity]);
    if (quantity === null) {
      // Остаток — то единственное, ради чего файл и загружают. Без него
      // строка бесполезна, но ронять всю загрузку из-за неё нельзя.
      invalid.push({ rowNumber, name, reason: 'не удалось прочитать количество' });
      continue;
    }

    if (quantity < 0) {
      invalid.push({ rowNumber, name, reason: `отрицательное количество (${quantity})` });
      continue;
    }

    rows.push({
      name,
      category,
      price: parseNumber(row[PRICE_LAYOUT.columns.price]),
      quantity: Math.trunc(quantity),
      rowNumber,
    });
  }

  return { rows, invalid };
}
