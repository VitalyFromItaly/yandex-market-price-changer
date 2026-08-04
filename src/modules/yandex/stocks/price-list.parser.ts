import * as XLSX from 'xlsx';

/**
 * Разбор прайс-листа поставщика.
 *
 * Раскладка подтверждена на двух живых файлах. Она одна и та же, а вот СМЫСЛ
 * файла между ними поменялся, и это главное, что нужно знать про этот модуль:
 *
 * - «Прайс 29.07.26.xlsx» (фикстура __tests__/fixtures/price-template.xlsx) —
 *   4349 строк, 18 категорий, пороги «>10». Приходило только то, что ЕСТЬ на
 *   складе, и количество стояло в каждой строке.
 * - `stock.xlsx` — 19 143 строки, 33 категории, пороги «>5». Приходит ВЕСЬ
 *   ассортимент, а количество заполнено лишь у 4736 позиций в наличии.
 *
 * Что это один и тот же ассортимент, видно по совпадению: «Восток» — 359 строк
 * с остатком против 360 в старом файле, «Командирские» — 147 против 147.
 *
 * Отсюда правило: ПУСТАЯ ячейка количества означает «нет в наличии», то есть
 * ноль (см. parsePriceList). До этого она отправляла строку в `invalid`, и на
 * новом файле отбрасывалось 14 407 строк из 19 143 — вместе с закупочными
 * ценами, а товар, которого на складе уже нет, оставался на Маркете со старым
 * остатком.
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
 * Строки-заголовки категорий: колонка A заполнена, B пуста. В `stock.xlsx` их 33
 * («ORIENT механические», «CASIO COLLECTION», «СЕВЕР Спорт», …). Их надо не
 * пропускать молча, а запоминать: категория попадает и в отчёт, и в определение
 * бренда скидки (см. brandOf в reports/brands.ts).
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

    const rawQuantity = row[PRICE_LAYOUT.columns.quantity];

    /**
     * ПУСТАЯ ячейка и НЕЧИТАЕМАЯ — разные вещи, и разница здесь стоит денег.
     *
     * Пустая означает «нет в наличии»: в этом файле приходит весь ассортимент, а
     * количество заполнено только у позиций на складе (4736 из 19 143). Значит
     * ноль — не догадка, а содержание файла.
     *
     * Мусор («нет», «—», склеенные ячейки) по-прежнему уходит в `invalid`.
     * Именно поэтому `parseQuantity` оставлена честной и на пустоту тоже отдаёт
     * `null`: ноль — это КОМАНДА обнулить остаток на Маркете, и нечитаемая
     * ячейка не должна превращаться в неё молча. Формат знает этот уровень, а не
     * функция разбора числа.
     */
    const isBlank = String(rawQuantity ?? '').trim() === '';
    const quantity = isBlank ? 0 : parseQuantity(rawQuantity);

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
