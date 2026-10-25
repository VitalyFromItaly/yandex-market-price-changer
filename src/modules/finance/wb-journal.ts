/**
 * Журнал отчёта реализации WB (sales-reports/detailed в прежних именах полей, TASK-136): ключ дедупа,
 * разбор строки отчёта в строку журнала, сводка нераспознанного. Чистые
 * функции — без Nest и базы; аналог `ozon-journal.ts`.
 *
 * Строка отчёта (`rrd_id`) ложится ОДНОЙ операцией, денежные колонки — частями
 * в `breakdown` (решение `wb_finance_row_per_rrd`, довод операции Ozon): ключ
 * у строки один, P&L раскладывает части той же `expandBreakdown`.
 *
 * Сумма строки — то, что она добавляет к «Итого к оплате» недельного отчёта
 * (решение `wb_finance_amount_formula`):
 *   знак × ppvz_for_pay − delivery_rub − storage_fee − penalty − deduction
 *   − acceptance + additional_payment,
 * знак −1 у `doc_type_name` «Возврат». Поэтому Σ сумм строк одного
 * `realizationreport_id` = к перечислению за неделю. `rebill_logistic_cost` в
 * сумму не входит: входит ли он уже в `delivery_rub`, на живом отчёте не
 * проверено (known-gaps).
 *
 * Выплата (TASK-185) — тоже из строки, метода выплат у WB нет: день — `create_dt`
 * отчёта (решение `wb_payout_by_create_dt`), поручение — номер отчёта, сумма
 * поручения — Σ его строк (`wb_payout_bank_order_report`).
 */

import type { IFinanceOperationContext, IFinanceOperationRow } from './finance-journal';
import type { IFinancePeriod } from './finance-period';
import type { IOperationBreakdownPart } from './operation-breakdown';
import type { ErrorReporter } from '../errors/error-reporter.service';

import { financeToday } from './finance-period';
import { kopecksToRub, toKopecks } from './kopecks';
import { parseOzonDateTime } from './ozon-journal';
import { WB_COLUMN_ARTICLE, WB_GOODS_OPERS, wbOperArticle } from './wb-articles';
import { operationKeyOf } from './ym-journal';

type TRaw = Record<string, unknown>;
type TArticle = IOperationBreakdownPart['article'];

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Пустая колонка — ноль: у строки логистики блок товара законно пуст. */
function kopecksOf(value: unknown): number {
  return toKopecks(value) ?? 0;
}

/**
 * Дата строки WB → момент. Формы те же, что у Ozon («ГГГГ-ММ-ДД», с временем,
 * с поясом или без — тогда по Москве), поэтому разбор общий.
 */
export const parseWbDateTime = parseOzonDateTime;

/** `rrd_id` — номер строки отчёта, ключ дедупа WB. */
export function wbRowIdOf(raw: TRaw): string {
  return text(raw.rrd_id);
}

/** Номер недельного отчёта реализации — по нему сверяется «к перечислению». */
export function wbReportIdOf(raw: TRaw): string {
  return text(raw.realizationreport_id);
}

const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

/**
 * День выплаты строки — начало дня `create_dt` по Москве (решение
 * `wb_payout_by_create_dt`): отчёт формируется после недели, тогда же WB
 * перечисляет «к оплате». Пусто или не дата — выплаты нет, строка ждёт её.
 */
export function wbPaidAtOf(raw: TRaw): Date | undefined {
  const at = parseWbDateTime(raw.create_dt);
  return at ? moscowStart(financeToday(at)) : undefined;
}

/**
 * Ключ операции для базы: площадка, `rrd_id` и СУММА. Сумма в ключе по
 * доводу `ozonOperationKey`: неизменяемые поля пишутся только вставкой, и
 * пересчитанная WB строка с ключом по одному id потерялась бы молча.
 */
export function wbOperationKey(rrdId: string, amountKopecks: number): string {
  return operationKeyOf(JSON.stringify(['wb', rrdId, amountKopecks]));
}

/** −1 у возврата: колонки WB положительны, направление несёт тип документа. */
export function wbSignOf(raw: TRaw): 1 | -1 {
  return text(raw.doc_type_name) === 'Возврат' ? -1 : 1;
}

/**
 * Части строки по статьям. Σ частей = сумме строки по построению: комиссия —
 * остаток блока товара до `ppvz_for_pay`, а не отдельная колонка WB.
 * Незнакомый тип — вся сумма одной частью `unknown`: что значит блок товара
 * у такого типа, мы не знаем.
 */
export function wbRowParts(raw: TRaw): IOperationBreakdownPart[] {
  const oper = text(raw.supplier_oper_name);
  const sign = wbSignOf(raw);
  const parts: IOperationBreakdownPart[] = [];
  const add = (article: TArticle, kopecks: number, sheet: string) => {
    if (kopecks) parts.push({ article, kopecks, sheet });
  };

  const forPay = sign * kopecksOf(raw.ppvz_for_pay);
  if (WB_GOODS_OPERS.has(oper)) {
    const sales = sign * kopecksOf(raw.retail_price_withdisc_rub);
    const acquiring = -sign * kopecksOf(raw.acquiring_fee);
    add(sign > 0 ? 'sales' : 'returns', sales, 'retail_price_withdisc_rub');
    add('acquiring', acquiring, 'acquiring_fee');
    add('commission', forPay - sales - acquiring, 'ppvz_for_pay');
  } else {
    add(wbOperArticle(oper), forPay, 'ppvz_for_pay');
  }

  add(
    kopecksOf(raw.return_amount) > 0 ? 'reverse_logistics' : 'delivery_to_buyer',
    -kopecksOf(raw.delivery_rub),
    'delivery_rub',
  );
  for (const [column, article] of Object.entries(WB_COLUMN_ARTICLE)) {
    const value = kopecksOf(raw[column]);
    add(article, column === 'additional_payment' ? value : -value, column);
  }

  if (WB_GOODS_OPERS.has(oper) || wbOperArticle(oper) !== 'unknown') return parts;
  const amount = parts.reduce((sum, part) => sum + part.kopecks, 0);
  return amount ? [{ article: 'unknown', kopecks: amount, sheet: null }] : [];
}

/** Сумма строки — Σ её частей. */
export function wbRowAmount(raw: TRaw): number {
  return wbRowParts(raw).reduce((sum, part) => sum + part.kopecks, 0);
}

/**
 * Статья строки целиком — для чтений без расшифровки (выплаты, счётчик
 * нераспознанного). Товарная строка — выручка или возврат, остальное — по
 * типу, незнакомый тип — `unknown`.
 */
function rowArticle(raw: TRaw, parts: readonly IOperationBreakdownPart[]): TArticle {
  const oper = text(raw.supplier_oper_name);
  if (WB_GOODS_OPERS.has(oper)) return wbSignOf(raw) > 0 ? 'sales' : 'returns';
  const byOper = wbOperArticle(oper);
  if (byOper !== 'unknown' || !parts.length) return byOper;
  return parts.some((part) => part.article === 'unknown') ? 'unknown' : parts[0].article;
}

/**
 * Строка отчёта WB → строка журнала. Без `rrd_id` или даты — бросает: это не
 * «строка на ноль», а форма ответа, которой мы не знаем.
 *
 * `skuOf` — артикул продавца (`sa_name`) → ключ закупа (товар → артикул ЯМ),
 * резолвится при импорте, как SKU Ozon. `payoutOf` — номер отчёта → Σ его
 * строк по всему ответу (`wbPayoutByReport`): отчёт на стыке месяцев делится
 * между двумя импортами, а поручение у него одно.
 */
export function wbRowToOperation(
  raw: TRaw,
  ctx: IFinanceOperationContext,
  skuOf: (vendorCode: string) => string | undefined = () => undefined,
  payoutOf: (reportId: string) => number | undefined = () => undefined,
): IFinanceOperationRow {
  const rrdId = wbRowIdOf(raw);
  if (!rrdId) throw new Error('Строка отчёта WB без rrd_id');
  const accruedAt = parseWbDateTime(raw.rr_dt);
  if (!accruedAt) throw new Error(`Строка отчёта WB ${rrdId} без даты rr_dt`);

  const parts = wbRowParts(raw);
  const amountKopecks = parts.reduce((sum, part) => sum + part.kopecks, 0);
  const articles = new Set(parts.map((part) => part.article));
  const vendorCode = text(raw.sa_name);
  // Поручения без дня выплаты не бывает: номер и сумма — только вместе с `paidAt`.
  const paidAt = wbPaidAtOf(raw);
  const reportId = paidAt ? wbReportIdOf(raw) : '';

  return {
    marketplace: 'wb',
    telegramUserId: ctx.telegramUserId,
    businessId: ctx.businessId,
    operationKey: wbOperationKey(rrdId, amountKopecks),
    article: rowArticle(raw, parts),
    direction: amountKopecks < 0 ? 'expense' : 'income',
    amountKopecks,
    orderId: text(raw.srid) || undefined,
    sku: vendorCode ? (skuOf(vendorCode) ?? vendorCode) : undefined,
    serviceName: text(raw.supplier_oper_name) || undefined,
    transactionType: text(raw.supplier_oper_name),
    transactionSource: text(raw.doc_type_name) || undefined,
    accruedAt,
    paidAt,
    bankOrderId: reportId || undefined,
    bankSumKopecks: reportId ? payoutOf(reportId) : undefined,
    documentId: ctx.documentId,
    documentVersion: ctx.documentVersion,
    periodKey: ctx.periodKey,
    raw,
    ...(articles.size > 1 ? { breakdown: parts } : {}),
  };
}

/**
 * Строки, чей день `rr_dt` (по Москве) лежит в периоде (решение
 * `wb_finance_period_by_rr_dt`). Недельный отчёт пересекает границу месяца,
 * и запрос идёт с запасом — без этой проверки строка легла бы в два месяца.
 */
export function wbRowsInPeriod(
  raws: readonly TRaw[],
  period: IFinancePeriod,
): { rows: TRaw[]; dropped: number } {
  const rows: TRaw[] = [];
  let dropped = 0;
  for (const raw of raws) {
    const at = parseWbDateTime(raw.rr_dt);
    const day = at ? financeToday(at) : null;
    if (day && day >= period.from && day <= period.to) rows.push(raw);
    else dropped += 1;
  }
  return { rows, dropped };
}

/** К перечислению по недельным отчётам: `realizationreport_id` → Σ сумм строк, копейки. */
export function wbPayoutByReport(raws: readonly TRaw[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const raw of raws) {
    const id = wbReportIdOf(raw) || '(без номера)';
    totals.set(id, (totals.get(id) ?? 0) + wbRowAmount(raw));
  }
  return totals;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as TRaw)
        .sort()
        .map((key) => [key, sortKeys((value as TRaw)[key])]),
    );
  }
  return value;
}

/**
 * «Оригинал» версии — строки периода JSON-ом, детерминированно (довод
 * `ozonFinanceOriginal`): ключи отсортированы, строки — по `rrd_id`, ни момента
 * запроса, ни страниц. Рядом — ключи закупа по артикулам продавца: товар
 * привязали позже — байты другие, и `refreshSku` допишет артикул.
 */
export function wbFinanceOriginal(
  period: IFinancePeriod,
  rows: readonly TRaw[],
  skuOf: (vendorCode: string) => string | undefined = () => undefined,
): Buffer {
  const sorted = [...rows].sort((a, b) => {
    const x = wbRowIdOf(a);
    const y = wbRowIdOf(b);
    return x.length - y.length || x.localeCompare(y);
  });
  const purchaseKeys: Record<string, string> = {};
  for (const row of sorted) {
    const vendorCode = text(row.sa_name);
    const key = vendorCode ? skuOf(vendorCode) : undefined;
    if (key) purchaseKeys[vendorCode] = key;
  }
  return Buffer.from(JSON.stringify(sortKeys({ period, rows: sorted, purchaseKeys })), 'utf8');
}

/** Отдельный класс — отдельный `errorType` в ключе троттлинга алертов. */
export class WbUnknownArticleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WbUnknownArticleError';
  }
}

/** Место алерта — без id продавца и периода, иначе троттлинг не сработает. */
export const WB_UNKNOWN_ARTICLE_CONTEXT = 'finance:wb-articles';

export interface IWbUnknownGroup {
  oper: string;
  count: number;
  amountKopecks: number;
}

/** Нераспознанные строки по типу (`supplier_oper_name`). */
export function wbUnknownGroups(ops: readonly IFinanceOperationRow[]): IWbUnknownGroup[] {
  const groups = new Map<string, IWbUnknownGroup>();
  for (const op of ops) {
    if (op.article !== 'unknown') continue;
    const oper = op.transactionType || '(без типа)';
    const group = groups.get(oper) ?? { oper, count: 0, amountKopecks: 0 };
    group.count += 1;
    group.amountKopecks += op.amountKopecks;
    groups.set(oper, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Один алерт на загрузку; возвращает число строк без статьи. */
export async function reportWbUnknownArticles(
  errors: Pick<ErrorReporter, 'report'>,
  ops: readonly IFinanceOperationRow[],
  telegramUserId: string,
): Promise<number> {
  const groups = wbUnknownGroups(ops);
  if (groups.length) {
    const lines = groups.map(
      (g) => `тип «${g.oper}»: ${g.count} шт., ${kopecksToRub(g.amountKopecks)} ₽`,
    );
    await errors.report({
      error: new WbUnknownArticleError(
        `Журнал WB: строки без статьи — допишите тип в wb-articles.ts\n${lines.join('\n')}`,
      ),
      source: 'queue',
      context: WB_UNKNOWN_ARTICLE_CONTEXT,
      telegramUserId,
    });
  }
  return ops.filter((op) => op.article === 'unknown').length;
}
