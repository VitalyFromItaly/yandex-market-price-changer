/**
 * Сверка журнала ЯМ с заказами и выплатами (TASK-113). Лист — без Nest и базы:
 * заказы из Маркета и операции из Postgres приносит FinanceReconcileService,
 * здесь только правило.
 *
 * Пять видов расхождений (ТЗ: «предупреждать об ошибках и расхождениях»):
 * - выкуплен без начислений — заказ выкуплен в месяце, а продажи по нему нет
 *   НИГДЕ в журнале;
 * - начисление по заказу, которого нет — orderId операции месяца не нашёлся
 *   ни в одном магазине кабинета;
 * - поручение не сходится — Σ строк платёжного поручения ≠ его сумме;
 * - статья не распознана — строка месяца без статьи;
 * - акт не сходится (TASK-158) — Σ акта в отчёте услуг ≠ −Σ строк журнала той
 *   же даты акта. Этой сверке соседи не нужны: строки акта лежат в журнале
 *   месяца целиком (дамп 09-2026: акты 31.08 и 30.09 — до копейки), а сумма
 *   журнала берётся по всему журналу продавца.
 *
 * Почему по ВСЕМУ журналу, а не внутри месяца. Отчёт united-netting за месяц —
 * это выплаченное в месяце плюс начисленное в нём и ещё не выплаченное.
 * Начисление продажи ложится в M−1 (предоплата: начислено при оплате), M или
 * M+1 (постоплата). На дампе 09-2026 сверка внутри месяца дала 183 ложных
 * «выкуплен без начислений». Поэтому ищем по журналу целиком, а сверку заказов
 * и выплат делаем, только когда загружены оба соседних месяца — иначе
 * «не проверено» (решение `finance_reconcile_neighbors`).
 */

import type { TFinanceArticle } from './finance-articles';
import type { IFinancePeriod } from './finance-period';

import { FINANCE_ARTICLE_META } from './finance-articles';
import { financeToday } from './finance-period';

export const RECONCILE_KINDS = [
  'delivered_without_accrual',
  'accrual_without_order',
  'payment_mismatch',
  'unknown_article',
  'act_mismatch',
] as const;
export type TReconcileKind = (typeof RECONCILE_KINDS)[number];

export const RECONCILE_KIND_LABEL: Readonly<Record<TReconcileKind, string>> = {
  delivered_without_accrual: 'Заказ выкуплен, а начислений нет',
  accrual_without_order: 'Начисление по заказу, которого нет',
  payment_mismatch: 'Сумма операций не равна выплате',
  unknown_article: 'Операция без статьи',
  act_mismatch: 'Акт не сходится с отчётом услуг',
};

/**
 * Допуск сравнения Σ строк поручения с его суммой — 0 копеек (решение
 * `finance_reconcile_tolerance`). Суммы хранятся целыми копейками
 * (`toKopecks`), накопленной ошибки float нет; на дампе 09-2026 все четыре
 * полных поручения сошлись до копейки. Любой допуск прятал бы ровно те мелкие
 * удержания, ради которых сверка есть.
 */
export const RECONCILE_TOLERANCE_KOPECKS = 0;

/** Сколько ссылок на операции хранить в одной находке: у поручения их тысячи. */
export const MAX_FINDING_OPERATION_REFS = 100;

/** Операция журнала — только то, что нужно сверке. */
export interface IReconcileOperation {
  id: string;
  orderId: string | null;
  article: TFinanceArticle;
  amountKopecks: number;
  bankOrderId: string | null;
  bankSumKopecks: number | null;
  paidAt: Date | null;
  periodKey: string | null;
}

export interface IReconcileFinding {
  kind: TReconcileKind;
  orderId?: string;
  bankOrderId?: string;
  /** Первые MAX_FINDING_OPERATION_REFS операций; всего — operationCount. */
  operationIds: string[];
  operationCount: number;
  expectedKopecks?: number;
  actualKopecks?: number;
  detail: string;
}

export interface IReconcileNeighbors {
  /** Загружен ли (импортирован) отчёт прошлого месяца. */
  prev: boolean;
  /** …и следующего. */
  next: boolean;
}

export interface IReconcileInput {
  period: IFinancePeriod;
  periodKey: string;
  /** Живые операции журнала продавца — не только этого месяца. */
  operations: readonly IReconcileOperation[];
  /** Заказы, выкупленные в месяце (по всем магазинам кабинета). */
  deliveredOrderIds: ReadonlySet<string>;
  /** Заказы из `orderIdsToLookup`, которые Маркет нашёл. */
  existingOrderIds: ReadonlySet<string>;
  neighbors: IReconcileNeighbors;
  /**
   * Акты, строки которых лежат в периоде (TASK-158). Нет поля — акты не
   * сверяются (тесты правил заказов и выплат), пустой массив — актов нет.
   */
  acts?: readonly IReconcileAct[];
}

/** Σ живых строк журнала с одной датой акта — по всему журналу продавца. */
export interface IReconcileActJournal {
  kopecks: number;
  operationCount: number;
  /** Первые MAX_FINDING_OPERATION_REFS id. */
  operationIds: string[];
}

export interface IReconcileAct {
  /** День акта по Москве, ГГГГ-ММ-ДД. */
  actDay: string;
  journal: IReconcileActJournal;
  /** Стоимость услуг акта по отчёту услуг, «+»; null — отчёта услуг нет. */
  servicesKopecks: number | null;
}

export interface IReconcileResult {
  findings: IReconcileFinding[];
  /** Почему сверка неполна (заказы и выплаты или акты); null — сделана целиком. */
  unchecked: string | null;
}

const isMoney = (article: TFinanceArticle) => {
  const group = FINANCE_ARTICLE_META[article].group;
  return group === 'income' || group === 'expense' || group === 'unknown';
};

/** Справочные строки (оплачено баллами) — не деньги и не часть выплаты. */
const isReference = (article: TFinanceArticle) =>
  FINANCE_ARTICLE_META[article].group === 'reference';

function refs(
  ops: readonly IReconcileOperation[],
): Pick<IReconcileFinding, 'operationIds' | 'operationCount'> {
  return {
    operationIds: ops.slice(0, MAX_FINDING_OPERATION_REFS).map((op) => op.id),
    operationCount: ops.length,
  };
}

function groupBy<K>(
  ops: readonly IReconcileOperation[],
  keyOf: (op: IReconcileOperation) => K | null,
): Map<K, IReconcileOperation[]> {
  const groups = new Map<K, IReconcileOperation[]>();
  for (const op of ops) {
    const key = keyOf(op);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(op);
    else groups.set(key, [op]);
  }
  return groups;
}

const ofPeriod = (input: Pick<IReconcileInput, 'operations' | 'periodKey'>) =>
  input.operations.filter((op) => op.periodKey === input.periodKey);

/**
 * Какие заказы спросить у Маркета: денежные операции месяца, чей заказ не
 * среди выкупленных в месяце (выкупленные и так существуют). Одно правило на
 * сервис и сверку — иначе сервис спросил бы одно, а сверка ждала другого.
 */
export function orderIdsToLookup(
  input: Pick<IReconcileInput, 'operations' | 'periodKey' | 'deliveredOrderIds'>,
): string[] {
  const ids = new Set<string>();
  for (const op of ofPeriod(input)) {
    if (op.orderId && isMoney(op.article) && !input.deliveredOrderIds.has(op.orderId)) {
      ids.add(op.orderId);
    }
  }
  return [...ids];
}

/** Месяцы-соседи, без которых сверка заказов и выплат неполна. */
function missingNeighbors(neighbors: IReconcileNeighbors): string | null {
  const missing = [neighbors.prev ? null : 'прошлого', neighbors.next ? null : 'следующего'].filter(
    Boolean,
  );
  if (!missing.length) return null;
  return (
    `Нет отчёта ${missing.join(' и ')} месяца: начисления и выплаты по заказам ` +
    'лежат и в соседних отчётах, без них сверка дала бы ложные расхождения'
  );
}

function deliveredWithoutAccrual(input: IReconcileInput): IReconcileFinding[] {
  const byOrder = groupBy(input.operations, (op) => op.orderId);
  const findings: IReconcileFinding[] = [];
  for (const orderId of [...input.deliveredOrderIds].sort()) {
    const ops = byOrder.get(orderId) ?? [];
    if (ops.some((op) => op.article === 'sales')) continue;
    findings.push({
      kind: 'delivered_without_accrual',
      orderId,
      ...refs(ops),
      detail: ops.length
        ? `Заказ ${orderId} выкуплен, по нему ${ops.length} операций, но ни одной продажи`
        : `Заказ ${orderId} выкуплен, в журнале по нему нет ни одной операции`,
    });
  }
  return findings;
}

function accrualWithoutOrder(input: IReconcileInput): IReconcileFinding[] {
  const lookup = new Set(orderIdsToLookup(input));
  const byOrder = groupBy(
    ofPeriod(input).filter((op) => isMoney(op.article)),
    (op) => op.orderId,
  );
  const findings: IReconcileFinding[] = [];
  for (const [orderId, ops] of [...byOrder].sort(([a], [b]) => a.localeCompare(b))) {
    if (!lookup.has(orderId) || input.existingOrderIds.has(orderId)) continue;
    const sum = ops.reduce((s, op) => s + op.amountKopecks, 0);
    findings.push({
      kind: 'accrual_without_order',
      orderId,
      ...refs(ops),
      actualKopecks: sum,
      detail: `Заказа ${orderId} нет ни в одном магазине кабинета, а операций по нему ${ops.length}`,
    });
  }
  return findings;
}

/**
 * Поручения, выплаченные в месяце (`paidAt` — дата поручения по Москве).
 * Строки поручения собираются по всему журналу: выплата 05.10 лежит частью в
 * отчёте сентября, частью — октября.
 */
function paymentMismatch(input: IReconcileInput): IReconcileFinding[] {
  const { from, to } = input.period;
  const byPayment = groupBy(input.operations, (op) => op.bankOrderId);
  const findings: IReconcileFinding[] = [];
  for (const [bankOrderId, ops] of [...byPayment].sort(([a], [b]) => a.localeCompare(b))) {
    const paidAt = ops.find((op) => op.paidAt)?.paidAt;
    if (!paidAt) continue;
    const day = financeToday(paidAt);
    if (day < from || day > to) continue;

    const money = ops.filter((op) => !isReference(op.article));
    const actual = money.reduce((s, op) => s + op.amountKopecks, 0);
    const sums = new Set(ops.map((op) => op.bankSumKopecks).filter((v): v is number => v !== null));
    if (sums.size > 1) {
      findings.push({
        kind: 'payment_mismatch',
        bankOrderId,
        ...refs(money),
        actualKopecks: actual,
        detail: `У строк поручения ${bankOrderId} разные суммы поручения: ${[...sums].join(', ')} коп.`,
      });
      continue;
    }
    const [expected] = [...sums];
    if (expected === undefined) continue;
    if (Math.abs(actual - expected) <= RECONCILE_TOLERANCE_KOPECKS) continue;
    findings.push({
      kind: 'payment_mismatch',
      bankOrderId,
      ...refs(money),
      expectedKopecks: expected,
      actualKopecks: actual,
      detail: `Поручение ${bankOrderId}: выплачено ${expected} коп., сумма операций ${actual} коп.`,
    });
  }
  return findings;
}

function unknownArticles(input: IReconcileInput): IReconcileFinding[] {
  return ofPeriod(input)
    .filter((op) => op.article === 'unknown')
    .map((op) => ({
      kind: 'unknown_article' as const,
      ...(op.orderId ? { orderId: op.orderId } : {}),
      ...refs([op]),
      actualKopecks: op.amountKopecks,
      detail: 'Классификатор не узнал тип операции',
    }));
}

/** «ГГГГ-ММ-ДД» → «ДД.ММ.ГГГГ», как дата акта в кабинете. */
const actLabel = (day: string) => day.split('-').reverse().join('.');

const rub = (kopecks: number) =>
  `${(kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

/**
 * Акты периода против отчёта услуг (TASK-158). Знаки противоположны: услуга в
 * отчёте — стоимость «+», в журнале — удержание «−» (за вычетом сторно вроде
 * скидки за лояльность), поэтому сравнивается услуги с −Σ журнала. Акт без
 * отчёта услуг — не находка, а неполнота сверки: «Проверено» без неё было бы
 * тем самым ложным «Проверено», которое эта сверка закрывает.
 */
export function actFindings(acts: readonly IReconcileAct[]): {
  findings: IReconcileFinding[];
  unchecked: string | null;
} {
  const findings: IReconcileFinding[] = [];
  const missing: string[] = [];
  for (const act of [...acts].sort((a, b) => a.actDay.localeCompare(b.actDay))) {
    if (act.servicesKopecks === null) {
      missing.push(actLabel(act.actDay));
      continue;
    }
    const actual = -act.journal.kopecks + 0;
    const diff = act.servicesKopecks - actual;
    if (Math.abs(diff) <= RECONCILE_TOLERANCE_KOPECKS) continue;
    findings.push({
      kind: 'act_mismatch',
      operationIds: act.journal.operationIds.slice(0, MAX_FINDING_OPERATION_REFS),
      operationCount: act.journal.operationCount,
      expectedKopecks: act.servicesKopecks,
      actualKopecks: actual,
      detail:
        `Акт ${actLabel(act.actDay)}: услуги ${rub(act.servicesKopecks)}, ` +
        `удержано по журналу ${rub(actual)}, разница ${rub(diff)}`,
    });
  }
  const unchecked = missing.length
    ? `Нет отчёта услуг за акт ${missing.join(', ')}: удержания акта не с чем сверить`
    : null;
  return { findings, unchecked };
}

/** Сошёлся ли каждый акт с отчётом услуг; акты без отчёта не попадают. */
export function actMatches(acts: readonly IReconcileAct[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const act of acts) {
    if (act.servicesKopecks === null) continue;
    const diff = act.servicesKopecks + act.journal.kopecks;
    result.set(act.actDay, Math.abs(diff) <= RECONCILE_TOLERANCE_KOPECKS);
  }
  return result;
}

/**
 * Сверка закрытого месяца. Без обоих соседей сверка заказов и выплат не
 * делается (`unchecked` с причиной); строки без статьи и акты считаются
 * всегда — им соседи не нужны. Причины неполноты склеиваются.
 */
export function reconcile(input: IReconcileInput): IReconcileResult {
  const neighbours = missingNeighbors(input.neighbors);
  const findings = neighbours
    ? []
    : [...deliveredWithoutAccrual(input), ...accrualWithoutOrder(input), ...paymentMismatch(input)];
  const acts = input.acts ? actFindings(input.acts) : { findings: [], unchecked: null };
  const unchecked = [neighbours, acts.unchecked].filter(Boolean).join('. ') || null;
  return { findings: [...findings, ...unknownArticles(input), ...acts.findings], unchecked };
}

/** Сколько находок каждого вида — для сводки скрипта и логов. */
export function countByKind(
  findings: readonly IReconcileFinding[],
): Record<TReconcileKind, number> {
  const counts = Object.fromEntries(RECONCILE_KINDS.map((k) => [k, 0])) as Record<
    TReconcileKind,
    number
  >;
  for (const f of findings) counts[f.kind] += 1;
  return counts;
}
