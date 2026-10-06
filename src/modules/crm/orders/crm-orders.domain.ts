import type { IReportResult } from '../../yandex/reports/order-reports.service';
import type { IReportPeriod } from '../../yandex/reports/report-period';
import type { TReportKey } from '../../yandex/reports/report-status-map';
import type { IReportWorkbook } from '../../yandex/reports/report-workbook';
import type { ICrmPeriodEcho } from '../jobs/crm-period.domain';

import { amountValue, orderTotals, type IMoneyTotals } from '../../yandex/reports/money';
import { moscowStamp } from '../../yandex/reports/moscow-day';
import {
  ASSEMBLING_NOTE,
  emptyReportText,
  truncatedNote,
  unboundedNote,
} from '../../yandex/reports/report-message';
import { DEFAULT_PERIOD, isUnbounded, periodTitle } from '../../yandex/reports/report-period';
import { REPORT } from '../../yandex/reports/report-status-map';
import { formatOfferIds } from '../../yandex/reports/report-workbook';
import { parsePeriodParams, periodEcho } from '../jobs/crm-period.domain';

/**
 * Отчёты о заказах в CRM — чистая часть: разбор параметров и вид ответа.
 *
 * Здесь НЕТ ни одной денежной формулы: числа приходят из `OrderReportsService.build`
 * (тот же вызов, что у бота), деньги строки — из `orderTotals`, книга — из
 * `reportWorkbook`. Своя арифметика здесь была бы второй копией, которая однажды
 * разойдётся с ботом «на рубль».
 */

/** Отчёты раздела — в порядке вкладок. Прибыль и калькулятор — свои разделы. */
export const CRM_ORDER_REPORTS = [
  REPORT.SHIPPED_TODAY,
  REPORT.REDEEMED,
  REPORT.RETURNING,
  REPORT.IN_TRANSIT,
] as const satisfies readonly TReportKey[];

export type TCrmOrderReport = (typeof CRM_ORDER_REPORTS)[number];

/** Имя kind-а фоновой задачи: замок дедупа — на каждый отчёт свой. */
export function ordersJobKind(key: TCrmOrderReport): string {
  return `orders:${key}`;
}

/**
 * Период из params задачи (`parsePeriodParams`). «Едет до клиента» — срез
 * «сейчас», периода у него нет (довод бота: кнопка, которая ничего не меняет),
 * поэтому для него params игнорируются целиком.
 */
export function parseOrdersParams(
  key: TCrmOrderReport,
  params: Record<string, unknown>,
): IReportPeriod {
  if (key === REPORT.IN_TRANSIT) return DEFAULT_PERIOD;
  return parsePeriodParams(params);
}

export type TCrmOrderRowType = 'order' | 'nonRedemption' | 'return';

/**
 * Строка таблицы — заказ или возврат ЦЕЛИКОМ (решение владельца 2026-09-24):
 * с суммой, чтобы таблицу можно было сверить с итогом. Разбивка по позициям
 * остаётся в xlsx «Едет обратно».
 */
export interface ICrmOrderRow {
  orderId: number | null;
  type: TCrmOrderRowType;
  date: string;
  status: string;
  items: string;
  sales: number;
  subsidies: number;
  withDelivery: number;
}

export interface ICrmOrdersView {
  key: TCrmOrderReport;
  title: string;
  count: number;
  totals: IMoneyTotals;
  /** Эхо запрошенного периода: фронт распознаёт по нему ответ чужой задачи. */
  period: ICrmPeriodEcho;
  /** Подпись периода, как в заголовке бота; у среза — null. */
  periodTitle: string | null;
  /** Момент съёмки «ДД-ММ-ГГГГ ЧЧ:ММ» (МСК) — у среза «Едет до клиента». */
  takenAt: string | null;
  /** FBY: сколько из count собирается на складе Маркета. */
  assembling: number | null;
  returns: { count: number; inFlight: number; settled: number; activeOnly: boolean } | null;
  /** Оговорки — те же формулировки, что у бота, без значков и разметки. */
  notes: string[];
  emptyText: string;
  rows: ICrmOrderRow[];
  file: { filename: string; rows: number; truncated: number } | null;
}

/**
 * Ответ CRM из результата сборки. Σ строк = `totals` по построению: заказ идёт
 * через `orderTotals` (как `sumTotals`), возврат — `amountValue(amount)` в
 * продажи и «с доставкой», субсидии 0 — ровно как `collectReturns`.
 */
export function toCrmOrdersView(
  result: IReportResult,
  workbook: IReportWorkbook | null,
  now: Date,
): ICrmOrdersView {
  const key = result.key as TCrmOrderReport;
  const snapshot = key === REPORT.IN_TRANSIT;
  const orderType: TCrmOrderRowType = key === REPORT.RETURNING ? 'nonRedemption' : 'order';

  const rows: ICrmOrderRow[] = result.orders.map((order) => ({
    orderId: order?.id ?? null,
    type: orderType,
    date: (order?.creationDate ?? '').trim(),
    // Как в книге «Едет обратно»: у невыкупа смысл несёт подстатус.
    status: (key === REPORT.RETURNING ? order?.substatus : undefined) ?? order?.status ?? '',
    // Артикулы, а не названия: так строки заказов и возвратов читаются одинаково
    // (у метода возвратов названий нет вовсе). Названия — в xlsx, колонка «Состав».
    items: formatOfferIds(order?.items),
    ...orderTotals(order),
  }));

  for (const record of result.returns?.records ?? []) {
    const value = amountValue(record.amount);
    rows.push({
      orderId: record.orderId ?? null,
      type: 'return',
      date: (record.creationDate ?? '').trim(),
      status: record.shipmentStatus ?? '',
      items: formatOfferIds(record.items),
      sales: value,
      subsidies: 0,
      withDelivery: value,
    });
  }

  const notes: string[] = [];
  if (result.assembling) notes.push(ASSEMBLING_NOTE);
  const unbounded = unboundedNote(result);
  if (unbounded) notes.push(unbounded);
  if (workbook?.truncated) notes.push(truncatedNote(key, workbook.rows, result.count));

  return {
    key,
    title: result.title,
    count: result.count,
    totals: result.totals,
    period: periodEcho(result.period),
    periodTitle: snapshot ? null : periodTitle(result.period, now),
    takenAt: snapshot ? moscowStamp(now) : null,
    assembling: result.assembling ?? null,
    returns: result.returns
      ? {
          count: result.returns.count,
          inFlight: result.returns.inFlight,
          settled: result.returns.settled,
          activeOnly: isUnbounded(result.period),
        }
      : null,
    notes,
    emptyText: emptyReportText(key),
    rows,
    file: workbook
      ? { filename: workbook.filename, rows: workbook.rows, truncated: workbook.truncated }
      : null,
  };
}
