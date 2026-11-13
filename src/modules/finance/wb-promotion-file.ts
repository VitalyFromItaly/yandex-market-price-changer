/**
 * Отчёт кабинета WB «Продвижение» файлом (TASK-209): списания за рекламу
 * (xlsx, xls, csv) → справочные строки журнала `promotion_report`.
 *
 * Зачем: в отчёте реализации WB реклама слита в `deduction` → `withholdings`
 * (матрица `docs/accounting-data-matrix.md`, п.6) — отдельной строкой её нет
 * ни в одном методе, который мы зовём. Файл «Продвижения» — единственный
 * источник рекламы по кампаниям.
 *
 * Почему справочно, а не `promotion` (решение `accounting_upload_reference_only`):
 * те же деньги уже лежат в `withholdings`; расходом они посчитались бы в P&L
 * дважды. Группа `reference` не входит ни в прибыль, ни в налог, ни в движение
 * денег — по построению, как `bonus_payment` ЯМ.
 *
 * Раскладка колонок не фиксирована — колонка ищется по заголовку из словаря
 * синонимов. Образца файла у нас нет (решение `accounting_upload_no_sample`):
 * синонимы — имена полей метода WB `adv/v1/upd` (история затрат) плюс
 * предполагаемые русские подписи кабинета; сверка на живом файле — known-gaps.
 *
 * Чистый модуль: Nest и базы не знает.
 */

import type { IFinanceOperationContext, IFinanceOperationRow } from './finance-journal';
import type { TValueKind } from './ym-netting-file';

import { normalizeHeader, sheetRows } from '../../shared/spreadsheet';
import { accountingColumnsOf } from '../accounting/accounting-sub-articles';

import { toKopecks } from './kopecks';
import { operationKeyOf, parseYmDateTime } from './ym-journal';
import { INVALID, NettingFileError, convertCell, readWorkbook } from './ym-netting-file';

type TRow = Record<string, unknown>;

/** Поля строки — имена `adv/v1/upd`: если кабинет выгружает их же, заголовок узнаётся как есть. */
export type TWbPromotionField =
  | 'advertId'
  | 'campName'
  | 'advertType'
  | 'updTime'
  | 'updNum'
  | 'updSum'
  | 'paymentType';

interface IPromotionColumn {
  label: string;
  kind: TValueKind;
  synonyms: readonly string[];
}

/** Словарь колонок. `Record` по полю: новое поле не скомпилируется без решения, как его искать. */
export const WB_PROMOTION_COLUMNS: Record<TWbPromotionField, IPromotionColumn> = {
  advertId: {
    label: 'ID кампании',
    kind: 'text',
    synonyms: ['ID кампании', 'ID РК', 'Номер кампании', 'Идентификатор кампании', 'ID'],
  },
  campName: {
    label: 'Название кампании',
    kind: 'text',
    synonyms: ['Название кампании', 'Название РК', 'Кампания', 'Наименование кампании'],
  },
  advertType: {
    label: 'Тип кампании',
    kind: 'text',
    synonyms: ['Тип кампании', 'Тип РК', 'Формат', 'Формат кампании', 'Тип продвижения'],
  },
  updTime: {
    label: 'Дата списания',
    kind: 'dateTime',
    synonyms: ['Дата списания', 'Дата и время списания', 'Время списания', 'Дата', 'Дата операции'],
  },
  updNum: {
    label: 'Номер документа',
    kind: 'text',
    synonyms: ['Номер документа', 'Номер списания', 'Документ', 'Номер операции'],
  },
  updSum: {
    label: 'Сумма списания',
    kind: 'money',
    synonyms: ['Сумма списания', 'Сумма', 'Списано', 'Сумма руб', 'Расход'],
  },
  paymentType: {
    label: 'Источник списания',
    kind: 'text',
    synonyms: ['Источник списания', 'Источник', 'Тип оплаты', 'Способ оплаты', 'Счёт списания'],
  },
};

/** Без кампании, даты и суммы строка — не списание. */
export const WB_PROMOTION_REQUIRED: readonly TWbPromotionField[] = [
  'advertId',
  'updTime',
  'updSum',
];

/**
 * Заголовки чужих отчётов: отчёт реализации WB (он грузится из API) и netting
 * ЯМ. Узнаём, чтобы отказать понятно, а не перечнем «не нашли колонки».
 */
const WRONG_REPORT_MARKERS = [
  'rrd_id',
  'realizationreport_id',
  'supplier_oper_name',
  'Обоснование для оплаты',
  'Номер отчёта',
  'Вайлдберриз реализовал Товар (Пр)',
  'transactionType',
  'transactionSum',
  'Тип транзакции',
];

/** Подпись типа строки в журнале, если кабинет тип кампании не дал. */
export const WB_PROMOTION_TRANSACTION_TYPE = 'Продвижение';

const HEADER_SCAN_ROWS = 30;

export interface IWbPromotionFileResult {
  rows: TRow[];
  sheet: string;
  headerRow: number;
  fields: TWbPromotionField[];
}

/** Синоним → поле. Один заголовок ведёт ровно в одно поле — пиннится тестом. */
export function wbPromotionHeaderIndex(): Map<string, TWbPromotionField> {
  const index = new Map<string, TWbPromotionField>();
  for (const [field, column] of Object.entries(WB_PROMOTION_COLUMNS) as [
    TWbPromotionField,
    IPromotionColumn,
  ][]) {
    for (const synonym of [field, ...column.synonyms]) index.set(normalizeHeader(synonym), field);
  }
  return index;
}

/**
 * Файл «Продвижения» → строки с полями `adv/v1/upd`. Отказы — `NettingFileError`
 * тех же видов, что у ЯМ: CRM переводит их в коды одним маппером. Строка с
 * битой датой или суммой — отказ с номером строки, не тихий пропуск.
 */
export function parseWbPromotionFile(buffer: Buffer, fileName: string): IWbPromotionFileResult {
  const workbook = readWorkbook(buffer, fileName);
  const index = wbPromotionHeaderIndex();
  const wrongMarkers = new Set(WRONG_REPORT_MARKERS.map(normalizeHeader));

  let best: {
    sheet: string;
    row: number;
    columns: Map<number, TWbPromotionField>;
    data: unknown[][];
  } | null = null;
  let sawWrong = false;
  for (const sheet of workbook.SheetNames) {
    const data = sheetRows(workbook, sheet);
    for (let r = 0; r < Math.min(data.length, HEADER_SCAN_ROWS); r++) {
      const columns = new Map<number, TWbPromotionField>();
      const taken = new Set<TWbPromotionField>();
      (data[r] ?? []).forEach((cell, c) => {
        const normalized = normalizeHeader(cell);
        if (wrongMarkers.has(normalized)) sawWrong = true;
        const field = index.get(normalized);
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
  const missing = WB_PROMOTION_REQUIRED.filter((f) => !found.has(f));
  if (sawWrong && (!best || missing.length || best.columns.size < 3)) {
    throw new NettingFileError(
      'wrong-report',
      'Это не отчёт «Продвижение»: похоже на отчёт о реализации WB или отчёт Маркета. ' +
        'Отчёт о реализации грузится сам из API; здесь нужен файл из кабинета WB «Продвижение».',
    );
  }
  if (!best || missing.length) {
    const labels = missing.map((f) => WB_PROMOTION_COLUMNS[f].label);
    throw new NettingFileError(
      'unrecognized',
      `Не похоже на отчёт WB «Продвижение»: не нашли колонки ${labels.map((l) => `«${l}»`).join(', ')}.`,
      { missing: labels },
    );
  }

  const rows: TRow[] = [];
  for (let r = best.row + 1; r < best.data.length; r++) {
    const cells = best.data[r] ?? [];
    const row: TRow = {};
    for (const [c, field] of best.columns) {
      const value = convertCell(cells[c], WB_PROMOTION_COLUMNS[field].kind);
      if (value === undefined) continue;
      if (value === INVALID) {
        // Подвал «Итого» несёт текст в колонке даты — это не битая строка.
        if (isTotalRow(cells)) break;
        throw new NettingFileError(
          'bad-row',
          `Строка ${r + 1}: не разобрали «${WB_PROMOTION_COLUMNS[field].label}» (${String(cells[c])}).`,
          { row: r + 1, field: WB_PROMOTION_COLUMNS[field].label },
        );
      }
      row[field] = value;
    }
    if (isTotalRow(cells)) continue;
    const present = WB_PROMOTION_REQUIRED.filter((f) => row[f] !== undefined);
    if (!present.length) continue;
    if (present.length < WB_PROMOTION_REQUIRED.length) {
      const absent = WB_PROMOTION_REQUIRED.filter((f) => row[f] === undefined).map(
        (f) => WB_PROMOTION_COLUMNS[f].label,
      );
      throw new NettingFileError(
        'bad-row',
        `Строка ${r + 1}: пусто в ${absent.map((l) => `«${l}»`).join(', ')}.`,
        { row: r + 1, field: absent[0] },
      );
    }
    rows.push(row);
  }

  if (!rows.length) throw new NettingFileError('empty', 'В файле нет ни одного списания.');
  return { rows, sheet: best.sheet, headerRow: best.row + 1, fields: [...best.columns.values()] };
}

/** Строка-подвал: первая непустая ячейка начинается с «Итого». */
function isTotalRow(cells: readonly unknown[]): boolean {
  const first = cells.find((cell) => String(cell ?? '').trim() !== '');
  return typeof first === 'string' && /^итог/i.test(first.trim());
}

const text = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim();

/**
 * Ключ списания: кампания, номер документа, момент и СУММА — как у ключей API,
 * пересчитанная сумма даёт новую строку. Пары в API у таких строк нет (реклама
 * там внутри `deduction`), поэтому ключ свой, а не `wbOperationKey`.
 */
export function wbPromotionOperationKey(
  advertId: string,
  documentNo: string,
  accruedAt: Date,
  amountKopecks: number,
): string {
  return operationKeyOf(
    JSON.stringify(['wb-promotion', advertId, documentNo, accruedAt.toISOString(), amountKopecks]),
  );
}

/**
 * Строка файла → справочная операция журнала. Списание в файле положительное —
 * в журнале расход со знаком минус; отрицательное (возврат на баланс) — плюс.
 */
export function wbPromotionRowToOperation(
  row: TRow,
  ctx: IFinanceOperationContext,
): IFinanceOperationRow {
  const advertId = text(row.advertId);
  const accruedAt = parseYmDateTime(row.updTime);
  if (!accruedAt) throw new Error(`Списание WB ${advertId} без даты`);
  const spent = toKopecks(row.updSum);
  if (spent === null) throw new Error(`Списание WB ${advertId} без суммы`);
  const amountKopecks = -spent;
  const transactionType = text(row.advertType) || WB_PROMOTION_TRANSACTION_TYPE;

  return {
    marketplace: 'wb',
    telegramUserId: ctx.telegramUserId,
    businessId: ctx.businessId,
    operationKey: wbPromotionOperationKey(advertId, text(row.updNum), accruedAt, amountKopecks),
    article: 'promotion_report',
    direction: amountKopecks < 0 ? 'expense' : 'income',
    amountKopecks,
    serviceName: text(row.campName) || undefined,
    transactionType,
    transactionSource: text(row.paymentType) || undefined,
    accruedAt,
    documentId: ctx.documentId,
    documentVersion: ctx.documentVersion,
    periodKey: ctx.periodKey,
    raw: row,
    ...accountingColumnsOf({ marketplace: 'wb', transactionType, raw: row }),
    // Подстатья — реклама, а не по типу операции отчёта реализации.
    subArticle: 'advertising',
  };
}
