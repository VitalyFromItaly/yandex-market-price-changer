/**
 * Детектор аномалий журнала (TASK-149). Лист — без Nest и базы: операции,
 * P&L месяца и находки сверки приносит FinanceAnomalyService, здесь только
 * правила. Детерминированный, не ИИ: каждое срабатывание объясняется порогом
 * из `ANOMALY_THRESHOLDS`, и продавец может его проверить по ссылкам на операции.
 *
 * Аномалия — вывод из текущих данных, а не событие (довод сверки TASK-113):
 * список месяца заменяется целиком, а отметка «просмотрено» живёт отдельно по
 * устойчивому `key` и сбрасывается, когда меняется `fingerprint` (решение
 * `finance_anomaly_review_fingerprint`).
 */

import type { TFinanceArticle } from './finance-articles';
import type { IFinancePeriod } from './finance-period';
import type { IReconcileFinding, TReconcileKind } from './finance-reconcile';
import type { IPnl, IPnlOperation } from './pnl';

import { FINANCE_ARTICLE_META } from './finance-articles';
import { financeToday } from './finance-period';
import { MAX_FINDING_OPERATION_REFS, RECONCILE_KIND_LABEL } from './finance-reconcile';
import { countOf, PNL_SECTION } from './pnl';
import { SKU_COLUMN_OF } from './pnl-sku';

export const ANOMALY_KINDS = [
  'commission_spike',
  'duplicate_accrual',
  'logistics_outlier',
  'penalty',
  'unknown_article',
  'reconcile',
  'missing_cost',
] as const;
export type TAnomalyKind = (typeof ANOMALY_KINDS)[number];

export const ANOMALY_KIND_LABEL: Readonly<Record<TAnomalyKind, string>> = {
  commission_spike: 'Доля комиссии выросла',
  duplicate_accrual: 'Похоже на двойное начисление',
  logistics_outlier: 'Нетипичная логистика на товар',
  penalty: 'Штраф',
  unknown_article: 'Нераспознанное удержание',
  reconcile: 'Отчёт не сходится с заказами',
  missing_cost: 'Нет закупочной цены',
};

/**
 * Пороги — одно место. Каждый подобран так, чтобы молчать на обычном месяце и
 * говорить там, где продавцу стоит открыть операции. Числа — стартовые: на
 * живых данных они не калибровались (known-gaps).
 */
export const ANOMALY_THRESHOLDS = {
  commission: {
    /** С чем сравниваем: медиана доли за столько прошлых месяцев. */
    historyMonths: 6,
    /** Меньше истории — медиана из двух точек ничего не значит, молчим. */
    minHistoryMonths: 3,
    /**
     * Месяц с выручкой меньше 10 000 ₽ не судится ни как текущий, ни как
     * история: одна возвращённая продажа двигает долю на десятки процентов.
     */
    minRevenueKopecks: 1_000_000,
    /** Рост в процентных пунктах — отсекает мелкие колебания тарифа. */
    minRisePoints: 3,
    /** …и в разах: на доле 30 % плюс 3 п.п. — обычный сезонный дрейф. */
    minRiseRatio: 1.25,
  },
  duplicates: {
    /**
     * Сколько одинаковых строк услуги по одному заказу в один день — уже
     * повод посмотреть. Только расходы: у продаж и возвратов две одинаковые
     * строки — это две штуки, и `journalKeys` различает их номером намеренно.
     * По той же причине группа с артикулом не дубль, если штук этого артикула
     * в заказе не меньше, чем строк: услуга могла начисляться за штуку.
     */
    minGroupSize: 2,
  },
  logistics: {
    /** Медиана по меньшему числу товаров — не «типичная», а случайная. */
    minSkus: 5,
    /** Логистика на штуку во столько раз выше медианы товаров месяца… */
    ratio: 3,
    /** …и не меньше чем на 150 ₽ за штуку: ×3 от 20 ₽ — это 60 ₽, не беда. */
    minExcessKopecks: 15_000,
  },
} as const;

/** Статьи комиссии — те же, что колонка `commission` unit-экономики (с эквайрингом). */
const isCommission = (article: TFinanceArticle) => SKU_COLUMN_OF[article] === 'commission';
const isLogistics = (article: TFinanceArticle) => SKU_COLUMN_OF[article] === 'logistics';
const isRevenue = (article: TFinanceArticle) => PNL_SECTION[article] === 'revenue';
const isExpense = (article: TFinanceArticle) => FINANCE_ARTICLE_META[article].group === 'expense';

export interface IAnomaly {
  kind: TAnomalyKind;
  /** Устойчивый ключ: тот же смысл в следующем прогоне — тот же ключ. */
  key: string;
  /** Отпечаток содержимого: изменился — отметка «просмотрено» снимается. */
  fingerprint: string;
  /** Первые MAX_FINDING_OPERATION_REFS операций; всего — operationCount. */
  operationIds: string[];
  operationCount: number;
  /** Деньги, о которых аномалия, копейки со знаком журнала; null — не про сумму. */
  amountKopecks: number | null;
  sku: string | null;
  orderId: string | null;
  /** Какой порог сработал — словами. */
  threshold: string;
  detail: string;
}

export interface IAnomalyInput {
  period: IFinancePeriod;
  periodKey: string;
  /**
   * Живые операции журнала с начислением от начала истории
   * (`anomalyHistoryStart`) до конца месяца. Строки других дней (выплаченные в
   * окне, начисленные раньше) отбрасываются здесь.
   */
  operations: readonly IPnlOperation[];
  /** P&L месяца — разрез по товарам и позиции без закупа. */
  pnl: Pick<IPnl, 'skus' | 'cogs'>;
  /** Находки сверки месяца (TASK-113). */
  discrepancies: readonly IReconcileFinding[];
}

/** Первый день истории сравнения комиссии: начало месяца за `historyMonths` до периода. */
export function anomalyHistoryStart(period: IFinancePeriod): string {
  const [y, m] = period.from.split('-').map(Number);
  const index = y * 12 + (m - 1) - ANOMALY_THRESHOLDS.commission.historyMonths;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

function refsOf(ops: readonly { id: string }[]): Pick<IAnomaly, 'operationIds' | 'operationCount'> {
  return {
    operationIds: ops.slice(0, MAX_FINDING_OPERATION_REFS).map((op) => op.id),
    operationCount: ops.length,
  };
}

const sum = (ops: readonly IPnlOperation[]) => ops.reduce((s, op) => s + op.amountKopecks, 0);

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 123456 → «1 234,56 ₽». Пробел обычный: текст идёт и в журнал, и в веб. */
export function rubText(kopecks: number): string {
  const sign = kopecks < 0 ? '−' : '';
  const [int, frac] = (Math.abs(kopecks) / 100).toFixed(2).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${frac} ₽`;
}

const percentText = (share: number) => `${(share * 100).toFixed(1).replace('.', ',')} %`;

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const monthOf = (day: string) => day.slice(0, 7);

/** Доля комиссии к выручке месяца; null — выручки мало, судить нечего. */
function commissionShare(ops: readonly IPnlOperation[]): number | null {
  const revenue = sum(ops.filter((op) => isRevenue(op.article)));
  if (revenue < ANOMALY_THRESHOLDS.commission.minRevenueKopecks) return null;
  return -sum(ops.filter((op) => isCommission(op.article))) / revenue;
}

function commissionSpike(
  input: IAnomalyInput,
  month: readonly IPnlOperation[],
  history: readonly IPnlOperation[],
): IAnomaly[] {
  const rule = ANOMALY_THRESHOLDS.commission;
  const current = commissionShare(month);
  if (current === null) return [];
  const shares = [...groupBy(history, (op) => monthOf(financeToday(op.accruedAt))).values()]
    .map(commissionShare)
    .filter((share): share is number => share !== null);
  if (shares.length < rule.minHistoryMonths) return [];
  const base = median(shares);
  if (base === null) return [];
  const risePoints = (current - base) * 100;
  if (risePoints < rule.minRisePoints || current < base * rule.minRiseRatio) return [];

  const ops = month.filter((op) => isCommission(op.article));
  return [
    {
      kind: 'commission_spike',
      key: `commission_spike:${input.periodKey}`,
      fingerprint: `${Math.round(current * 10_000)}:${ops.length}`,
      ...refsOf(ops),
      amountKopecks: sum(ops),
      sku: null,
      orderId: null,
      threshold:
        `рост не меньше ${rule.minRisePoints} п.п. и в ${rule.minRiseRatio} раза к медиане ` +
        `${shares.length} прошлых месяцев`,
      detail:
        `Комиссия с эквайрингом — ${percentText(current)} выручки против ` +
        `${percentText(base)} обычно (+${risePoints.toFixed(1).replace('.', ',')} п.п.)`,
    },
  ];
}

/** Продано штук артикула в заказе — по строкам продаж всего окна (продажа бывает в M−1). */
function unitsInOrders(ops: readonly IPnlOperation[]): Map<string, number> {
  const units = new Map<string, number>();
  for (const op of ops) {
    if (op.article !== 'sales' || !op.orderId || !op.sku) continue;
    const key = `${op.orderId}|${op.sku}`;
    units.set(key, (units.get(key) ?? 0) + (countOf(op.count) ?? 1));
  }
  return units;
}

function duplicateAccruals(input: IAnomalyInput, month: readonly IPnlOperation[]): IAnomaly[] {
  const units = unitsInOrders(input.operations);
  const groups = groupBy(month, (op) =>
    isExpense(op.article) && op.orderId
      ? JSON.stringify([
          op.article,
          op.transactionType,
          op.serviceName,
          op.orderId,
          op.sku,
          op.amountKopecks,
          financeToday(op.accruedAt),
        ])
      : null,
  );
  const found: IAnomaly[] = [];
  for (const [identity, ops] of groups) {
    if (ops.length < ANOMALY_THRESHOLDS.duplicates.minGroupSize) continue;
    const [op] = ops;
    // Услуга за штуку: две строки на заказ из двух штук — не дубль.
    if (op.sku && (units.get(`${op.orderId}|${op.sku}`) ?? 0) >= ops.length) continue;
    found.push({
      kind: 'duplicate_accrual',
      key: `duplicate_accrual:${input.periodKey}:${identity}`,
      fingerprint: `${sum(ops)}:${ops.length}`,
      ...refsOf(ops),
      amountKopecks: sum(ops),
      sku: op.sku,
      orderId: op.orderId,
      threshold: `${ANOMALY_THRESHOLDS.duplicates.minGroupSize} и больше одинаковых строк услуги в день`,
      detail:
        `Заказ ${op.orderId}: «${op.serviceName ?? op.transactionType}» ` +
        `${ops.length} раза по ${rubText(op.amountKopecks)} за ${financeToday(op.accruedAt)}`,
    });
  }
  return found;
}

function logisticsOutliers(input: IAnomalyInput, month: readonly IPnlOperation[]): IAnomaly[] {
  const rule = ANOMALY_THRESHOLDS.logistics;
  const perUnit = input.pnl.skus.skus
    .filter((sku) => sku.units >= 1)
    .map((sku) => ({ sku, kopecks: -sku.columns.logistics / sku.units }));
  if (perUnit.length < rule.minSkus) return [];
  const base = median(perUnit.map((row) => row.kopecks));
  if (base === null) return [];

  // Заказы товара — по его строкам продаж месяца: заказная логистика без
  // артикула делится между ними (pnl-sku), значит и ссылки ведут туда.
  const ordersOf = new Map<string, Set<string>>();
  for (const op of month) {
    if (op.article !== 'sales' || !op.sku || !op.orderId) continue;
    const orders = ordersOf.get(op.sku) ?? new Set<string>();
    orders.add(op.orderId);
    ordersOf.set(op.sku, orders);
  }

  const found: IAnomaly[] = [];
  for (const { sku, kopecks } of perUnit) {
    if (kopecks < base * rule.ratio || kopecks - base < rule.minExcessKopecks) continue;
    const orders = ordersOf.get(sku.sku) ?? new Set<string>();
    const ops = month.filter(
      (op) =>
        isLogistics(op.article) &&
        (op.sku === sku.sku || (!op.sku && op.orderId !== null && orders.has(op.orderId))),
    );
    const perUnitKopecks = Math.round(kopecks);
    found.push({
      kind: 'logistics_outlier',
      key: `logistics_outlier:${input.periodKey}:${sku.sku}`,
      fingerprint: `${sku.columns.logistics}:${sku.units}`,
      ...refsOf(ops),
      amountKopecks: sku.columns.logistics,
      sku: sku.sku,
      orderId: null,
      threshold:
        `в ${rule.ratio} раза выше медианы товаров месяца и дороже её ` +
        `на ${rubText(rule.minExcessKopecks)} за штуку`,
      detail:
        `${sku.sku}: логистика ${rubText(perUnitKopecks)} на штуку ` +
        `(${sku.units} шт.) против ${rubText(Math.round(base))} в среднем по товарам`,
    });
  }
  return found;
}

function bySignature(
  input: IAnomalyInput,
  month: readonly IPnlOperation[],
  kind: 'penalty' | 'unknown_article',
  article: TFinanceArticle,
): IAnomaly[] {
  const groups = groupBy(
    month.filter((op) => op.article === article),
    (op) => `${op.transactionType} · ${op.serviceName ?? '—'}`,
  );
  return [...groups].map(([signature, ops]) => ({
    kind,
    key: `${kind}:${input.periodKey}:${signature}`,
    fingerprint: `${sum(ops)}:${ops.length}`,
    ...refsOf(ops),
    amountKopecks: sum(ops),
    sku: null,
    orderId: null,
    threshold: kind === 'penalty' ? 'любой штраф' : 'любая строка, которой классификатор не знает',
    detail: `«${signature}»: ${ops.length} строк на ${rubText(sum(ops))}`,
  }));
}

function missingCost(input: IAnomalyInput): IAnomaly[] {
  return input.pnl.cogs.unknown.map((row) => ({
    kind: 'missing_cost',
    key: `missing_cost:${input.periodKey}:${row.sku}`,
    fingerprint: `${row.count}:${row.operationIds.length}`,
    ...refsOf(row.operationIds.map((id) => ({ id }))),
    amountKopecks: null,
    sku: row.sku || null,
    orderId: null,
    threshold: 'любая проданная позиция без закупа на дату продажи',
    detail: row.sku
      ? `${row.sku}: ${row.count} шт. без закупочной цены — чистая прибыль завышена`
      : `Строки продаж без артикула (${row.operationIds.length}) — себестоимость не посчитать`,
  }));
}

/**
 * Неизвестные статьи сверки ловит свой детектор с разбивкой по подписи — не дублируем.
 * Расхождение акта (TASK-158) не проецируется: ключ аномалии собран из заказа и
 * поручения, у находки акта нет ни того, ни другого — два акта месяца получили бы
 * один ключ. Его видно в статусе периода, на «Очередях» и во вкладке «Сверка».
 */
const PROJECTED_RECONCILE_KINDS: ReadonlySet<TReconcileKind> = new Set([
  'delivered_without_accrual',
  'accrual_without_order',
  'payment_mismatch',
]);

function reconcileFindings(input: IAnomalyInput): IAnomaly[] {
  return input.discrepancies
    .filter((f) => PROJECTED_RECONCILE_KINDS.has(f.kind))
    .map((f) => ({
      kind: 'reconcile' as const,
      key: `reconcile:${input.periodKey}:${f.kind}:${f.orderId ?? ''}:${f.bankOrderId ?? ''}`,
      fingerprint: `${f.actualKopecks ?? ''}:${f.expectedKopecks ?? ''}:${f.operationCount}`,
      operationIds: f.operationIds.slice(0, MAX_FINDING_OPERATION_REFS),
      operationCount: f.operationCount,
      amountKopecks: f.actualKopecks ?? null,
      sku: null,
      orderId: f.orderId ?? null,
      threshold: `${RECONCILE_KIND_LABEL[f.kind]} (сверка, допуск 0 коп.)`,
      detail: f.detail,
    }));
}

export function detectAnomalies(input: IAnomalyInput): IAnomaly[] {
  const historyFrom = anomalyHistoryStart(input.period);
  const month: IPnlOperation[] = [];
  const history: IPnlOperation[] = [];
  for (const op of input.operations) {
    const day = financeToday(op.accruedAt);
    if (day >= input.period.from && day <= input.period.to) month.push(op);
    else if (day >= historyFrom && day < input.period.from) history.push(op);
  }
  // Ключ не должен зависеть от порядка строк из базы.
  month.sort((a, b) => a.id.localeCompare(b.id));

  const found = [
    ...commissionSpike(input, month, history),
    ...duplicateAccruals(input, month),
    ...logisticsOutliers(input, month),
    ...bySignature(input, month, 'penalty', 'penalties'),
    ...bySignature(input, month, 'unknown_article', 'unknown'),
    ...reconcileFindings(input),
    ...missingCost(input),
  ];
  const order = new Map(ANOMALY_KINDS.map((kind, i) => [kind, i]));
  return found.sort((a, b) => order.get(a.kind) - order.get(b.kind) || a.key.localeCompare(b.key));
}

export function countAnomaliesByKind(anomalies: readonly IAnomaly[]): Record<TAnomalyKind, number> {
  const counts = Object.fromEntries(ANOMALY_KINDS.map((kind) => [kind, 0])) as Record<
    TAnomalyKind,
    number
  >;
  for (const anomaly of anomalies) counts[anomaly.kind] += 1;
  return counts;
}
