/**
 * Журнал финансовых операций Яндекс.Маркета (отчёт united-netting): ключ
 * дедупа и разбор строки в операцию. Чистые функции — без Nest и базы.
 *
 * Карта отчёта и происхождение ключа — решения `finance_ym_report_map` и
 * `finance_ym_dedup_key` (TASK-108, живой кабинет за 09-2026).
 */

import type { IFinanceOperationContext, IFinanceOperationRow } from './finance-journal';

import { createHash } from 'node:crypto';

import { toKopecks } from './kopecks';
import { classifyYmRow } from './ym-articles';

// Строка журнала переехала в общий лист (TASK-131); импорты отсюда остаются рабочими.
export type { IFinanceOperationContext, IFinanceOperationRow } from './finance-journal';

type TRow = Record<string, unknown>;

/**
 * Поля строки журнала, из которых строится ключ дедупа.
 *
 * Идентификатора у строки НЕТ (`transactionId` null во всех 21 663 строках),
 * поэтому ключ — устойчивые поля: что за операция, по какому заказу и товару,
 * когда и на сколько. НЕ входят paymentStatus/bankOrderId/bankOrderDate/bankSum —
 * они дописываются, когда Маркет платит, и ключ с ними сделал бы из одной
 * операции две.
 */
export const JOURNAL_KEY_FIELDS = [
  'orderId',
  'shopSku',
  'offerOrServiceName',
  'transactionType',
  'transactionSource',
  'transactionDate',
  'actId',
  'transactionSum',
  'count',
] as const;

/**
 * Читаемый ключ строки: устойчивые поля + номер среди строк с тем же
 * содержимым. Номер нужен, потому что полностью одинаковые строки бывают
 * (две штуки товара в заказе — двумя строками), и это две операции, а не дубль.
 *
 * Номер зависит от порядка ОДИНАКОВЫХ строк, а он не важен: строки с одним
 * содержимым взаимозаменяемы. Порядок остальных строк между прогонами
 * меняется (проверено) — на ключи это не влияет.
 */
export function journalKeys(rows: readonly TRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = JSON.stringify(JOURNAL_KEY_FIELDS.map((f) => row[f] ?? null));
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

/** Лист united-netting со строками журнала (решение `finance_ym_report_map`). */
export const YM_NETTING_SHEET = 'transaction_date';

/**
 * Строки журнала из распакованного отчёта (`unzipReportJson`). Лист — объект
 * `{rows: [...]}`. Нет листа или нет массива строк — ошибка с перечнем того,
 * что пришло: иначе сменившаяся форма отчёта выглядела бы как «операций нет».
 */
export function nettingRowsOf(sheets: ReadonlyMap<string, unknown>): TRow[] {
  const sheet = sheets.get(YM_NETTING_SHEET);
  const rows = (sheet as { rows?: unknown } | undefined)?.rows;
  if (!Array.isArray(rows)) {
    const names = [...sheets.keys()].join(', ') || 'нет листов';
    throw new Error(
      `В отчёте united-netting нет листа ${YM_NETTING_SHEET} со строками (пришло: ${names})`,
    );
  }
  return rows.filter((row): row is TRow => !!row && typeof row === 'object' && !Array.isArray(row));
}

/**
 * Ключ операции для базы: sha256 читаемого ключа. Фиксированная длина для
 * уникального индекса — читаемый ключ несёт название услуги и бывает длинным.
 * Читаемая форма остаётся в `raw` строки.
 */
export function operationKeyOf(journalKey: string): string {
  return createHash('sha256').update(journalKey).digest('hex');
}

/** Московское время — фиксированный +03:00: переходов на летнее время нет с 2014. */
const MSK = '+03:00';

/** «ДД.ММ.ГГГГ ЧЧ:ММ» (МСК) → Date. Мусор → null. */
export function parseYmDateTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return validDate(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00${MSK}`, m);
}

/** «ДД.ММ.ГГГГ» (МСК, начало дня) → Date. Мусор → null. */
export function parseYmDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!m) return null;
  return validDate(`${m[3]}-${m[2]}-${m[1]}T00:00:00${MSK}`, m);
}

/**
 * `new Date('2026-02-31…')` молча уезжает в март — проверяем, что день и месяц
 * остались теми, что пришли.
 */
function validDate(iso: string, m: RegExpExecArray): Date | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  if (msk.getUTCDate() !== Number(m[1]) || msk.getUTCMonth() + 1 !== Number(m[2])) return null;
  return date;
}

const text = (value: unknown): string | undefined =>
  value === null || value === undefined || value === '' ? undefined : String(value);

/** Контекст версии — общий для площадок (`finance-journal.ts`); имя ЯМ оставлено вызывающим. */
export type IYmOperationContext = IFinanceOperationContext;

/**
 * Строка журнала → операция. Статья — из `classifyYmRow` (`ym-articles.ts`).
 * Ключ от статьи не зависит: исправленный классификатор переставляет статью
 * (`$set`), а не рождает вторую операцию.
 *
 * Строка без суммы или без даты операции бросает: это не «операция на ноль»,
 * а форма отчёта, которой мы не знаем, и молча записать её нельзя.
 */
export function nettingRowToOperation(
  row: TRow,
  journalKey: string,
  ctx: IYmOperationContext,
): IFinanceOperationRow {
  const amountKopecks = toKopecks(row.transactionSum);
  if (amountKopecks === null) {
    throw new Error(`Строка журнала без суммы: ${journalKey}`);
  }
  const accruedAt = parseYmDateTime(row.transactionDate);
  if (!accruedAt) {
    throw new Error(`Строка журнала без даты операции: ${journalKey}`);
  }

  return {
    marketplace: 'ym',
    telegramUserId: ctx.telegramUserId,
    businessId: ctx.businessId,
    operationKey: operationKeyOf(journalKey),
    article: classifyYmRow(row).article,
    // Знак — как у Маркета: «+» деньги продавцу, «−» удержание.
    direction: amountKopecks < 0 ? 'expense' : 'income',
    amountKopecks,
    orderId: text(row.orderId),
    sku: text(row.shopSku),
    serviceName: text(row.offerOrServiceName),
    transactionType: String(row.transactionType ?? ''),
    transactionSource: text(row.transactionSource),
    accruedAt,
    actId: text(row.actId),
    actDate: parseYmDate(row.actDate) ?? undefined,
    model: text(row.model),
    paymentStatus: text(row.paymentStatus),
    paidAt: parseYmDate(row.bankOrderDate) ?? parseYmDateTime(row.bankOrderDate) ?? undefined,
    bankOrderId: text(row.bankOrderId),
    bankSumKopecks: toKopecks(row.bankSum) ?? undefined,
    documentId: ctx.documentId,
    documentVersion: ctx.documentVersion,
    periodKey: ctx.periodKey,
    raw: row,
  };
}

/**
 * Канонический вид ключевых полей строки — для сопоставления ручного файла с
 * операциями, уже записанными импортом Маркета (TASK-114).
 *
 * `journalKeys` хэширует значения как есть: `123` и `"123"`, `1234.5` и
 * `"1 234,50"` дают разные ключи. Каких типов значения в JSON Маркета, а каких —
 * в выгрузке кабинета, мы наверняка не знаем (образца xlsx нет, решение
 * `finance_upload_no_sample`), поэтому «0 дублей» держится не на угадывании
 * типов, а на этом сравнении: текст обрезан, сумма — в копейках, штуки — числом,
 * дата — моментом. Сам `journalKeys` не меняется — на нём проверена
 * стабильность ключей между прогонами (решение `finance_ym_dedup_key`).
 */
export function canonicalJournalIdentity(row: TRow): string {
  return JSON.stringify(
    JOURNAL_KEY_FIELDS.map((field) => {
      const value = row[field];
      if (value === null || value === undefined || value === '') return null;
      if (field === 'transactionSum') return toKopecks(value) ?? String(value).trim();
      if (field === 'transactionDate') {
        return parseYmDateTime(value)?.toISOString() ?? String(value).trim();
      }
      if (field === 'count') {
        const n = Number(typeof value === 'string' ? value.trim().replace(',', '.') : value);
        return Number.isFinite(n) ? n : String(value).trim();
      }
      return String(value).trim();
    }),
  );
}

/** Уже записанная операция, с которой сопоставляется строка ручного файла. */
export interface IJournalExistingOperation {
  operationKey: string;
  raw: TRow;
  superseded: boolean;
}

/**
 * Строки ручного файла → уже записанные операции с тем же каноническим видом
 * (`canonicalJournalIdentity`). Одинаковые строки сопоставляются по порядку —
 * тот же довод, что номер в `journalKeys`: две штуки товара — две операции.
 * Живые идут раньше снятых: строка с тем же видом скорее та, что жива.
 *
 * `null` — пары нет, строка новая и получит свой ключ из `journalKeys`.
 */
export function matchExistingOperations(
  rows: readonly TRow[],
  existing: readonly IJournalExistingOperation[],
): ({ operationKey: string; superseded: boolean } | null)[] {
  const pool = new Map<string, IJournalExistingOperation[]>();
  const ordered = [...existing].sort((a, b) => Number(a.superseded) - Number(b.superseded));
  for (const op of ordered) {
    const identity = canonicalJournalIdentity(op.raw);
    const list = pool.get(identity);
    if (list) list.push(op);
    else pool.set(identity, [op]);
  }
  return rows.map((row) => {
    const op = pool.get(canonicalJournalIdentity(row))?.shift();
    return op ? { operationKey: op.operationKey, superseded: op.superseded } : null;
  });
}
