/**
 * Сверка v2 «Финучёта» (ТЗ п.12, TASK-226): суммы реестра по статьям против
 * официальных документов площадки за месяц, разница — до операций-кандидатов.
 *
 * Рядом с текущей `reconcile()` (`finance-reconcile.ts`), а не вместо неё
 * (решение `accounting_beside_current`): та пишет находки периода и статус
 * месяца, эта ничего не пишет — считается на запрос из того же журнала.
 *
 * Документы ЯМ в базе — только два (матрица `docs/accounting-data-matrix.md`):
 * - **акт + отчёт услуг** (`finance_act_services`: итог и Σ по листам) — у
 *   комиссии, логистики и прочих услуг;
 * - **платёжные поручения** (`bankOrderId`/`bankSumKopecks` на строках) — у выплат.
 * Отчёта о реализации нет, поэтому у продаж, возвратов, компенсаций, итога
 * начислений и остатка документа нет — «недостаточно данных», без выдумки.
 *
 * Ozon и WB (TASK-227) — тот же результат и статусы, другие документы
 * (`RECONCILE_LINE_DOCUMENT`):
 * - **Ozon** — сальдо месяца `/v1/finance/balance` (`finance_ozon_balances`):
 *   итог начислений против `accrued`, остаток — против `closing_balance`
 *   (решение `accounting_reconcile_ozon_balance`). Выплаты без документа:
 *   дневная выплата Ozon без номера и состава, строки разложены по ней FIFO —
 *   сверка с ней была бы сверкой с собой;
 * - **WB** — документа нет совсем: «сумма поручения» — Σ тех же строк отчёта
 *   (решение `accounting_reconcile_wb_no_document`); поручения не показываются.
 * Ни у одной статьи и акта нет документа — итог «недостаточно данных»
 * (решение `accounting_reconcile_zero_documents`), а не «сверено не всё».
 *
 * Итог «сверено» — когда нет расхождений там, где документ есть; статьи без
 * документа помечены каждая, а итог — `partial` (решение
 * `accounting_reconcile_status_available`). Ручные операции входят в суммы
 * статей с пометкой `manual`; у статьи с документом они — кандидат «нет пары
 * в документе» (решение `accounting_reconcile_manual_included`).
 *
 * Лист: чистые функции, без Nest и базы.
 */

import type { TAccountingSubArticle } from './accounting-sub-articles';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TFinanceArticle } from '../finance/finance-articles';
import type { IFinancePeriod } from '../finance/finance-period';

import { FINANCE_ARTICLE_META } from '../finance/finance-articles';
import {
  MAX_FINDING_OPERATION_REFS,
  RECONCILE_TOLERANCE_KOPECKS,
} from '../finance/finance-reconcile';
import { expandBreakdown } from '../finance/operation-breakdown';
import { YM_ACT_SUMMARY_SHEETS } from '../finance/ym-act-breakdown';

import { ACCOUNTING_SUB_ARTICLE_TITLE } from './accounting-sub-articles';

// ─── Статьи сверки ──────────────────────────────────────────────────────────

/** Статьи начислений — на них раскладывается каждая строка реестра. */
export type TReconcileAccrualLine =
  | 'sales'
  | 'returns'
  | 'commission'
  | 'logistics'
  | 'other_services'
  | 'compensations'
  | 'unknown';

/** Все статьи экрана: начисления, итог начислений, выплаты, остаток взаиморасчётов. */
export type TReconcileLine = TReconcileAccrualLine | 'accrual_total' | 'payouts' | 'balance';

export type TReconcileDocument = 'act' | 'payment_orders' | 'ozon_balance';

/** Чем сумма реестра статьи сопоставима с документом. */
export type TReconcileBasis = 'act_days' | 'accrued_in_month' | 'paid_in_month';

export interface IReconcileLineMeta {
  title: string;
  /** База реестра у ЯМ; у площадки без актов статьи акта — по дню начисления. */
  basis: TReconcileBasis;
}

export const RECONCILE_LINE_META: Record<TReconcileLine, IReconcileLineMeta> = {
  sales: { title: 'Продажи', basis: 'accrued_in_month' },
  returns: { title: 'Возвраты и корректировки', basis: 'accrued_in_month' },
  commission: { title: 'Комиссии', basis: 'act_days' },
  logistics: { title: 'Логистика', basis: 'act_days' },
  other_services: { title: 'Прочие услуги', basis: 'act_days' },
  compensations: { title: 'Компенсации и субсидии', basis: 'accrued_in_month' },
  unknown: { title: 'Не распознано', basis: 'accrued_in_month' },
  accrual_total: { title: 'Итог начислений', basis: 'accrued_in_month' },
  // Выплаты — движение денег, не прибыль: блок отдельный, в итог начислений не входит.
  payouts: { title: 'Выплаты', basis: 'paid_in_month' },
  balance: { title: 'Остаток взаиморасчётов', basis: 'accrued_in_month' },
};

const NO_DOCUMENTS: Record<TReconcileLine, null> = {
  sales: null,
  returns: null,
  commission: null,
  logistics: null,
  other_services: null,
  compensations: null,
  unknown: null,
  accrual_total: null,
  payouts: null,
  balance: null,
};

/** Официальный документ статьи по площадке; null — документа в базе нет. */
export const RECONCILE_LINE_DOCUMENT: Record<
  TFinanceMarketplace,
  Record<TReconcileLine, TReconcileDocument | null>
> = {
  ym: {
    ...NO_DOCUMENTS,
    commission: 'act',
    logistics: 'act',
    other_services: 'act',
    payouts: 'payment_orders',
  },
  ozon: { ...NO_DOCUMENTS, accrual_total: 'ozon_balance', balance: 'ozon_balance' },
  wb: NO_DOCUMENTS,
};

/** Площадка в родительном падеже — для текстов продавцу («документы Маркета», «у WB»). */
export const RECONCILE_MARKETPLACE_OF: Record<TFinanceMarketplace, string> = {
  ym: 'Маркета',
  ozon: 'Ozon',
  wb: 'WB',
};

export const RECONCILE_ACCRUAL_LINES: readonly TReconcileAccrualLine[] = [
  'sales',
  'returns',
  'commission',
  'logistics',
  'other_services',
  'compensations',
  'unknown',
];

export const RECONCILE_DOCUMENT_TITLE: Record<TReconcileDocument, string> = {
  act: 'Акт и отчёт об услугах',
  payment_orders: 'Платёжные поручения',
  ozon_balance: 'Сальдо Ozon за месяц',
};

/**
 * Статья журнала → статья сверки. Группы — как у обзора «Финансов»
 * (`OVERVIEW_SERVICE_GROUP`): логистика — доставка, обратная логистика,
 * хранение, приёмка, обработка; прочие — всё остальное удержанное. Оплата
 * баллами справочная, не деньги, — ни в одну статью.
 */
export const RECONCILE_LINE_OF_ARTICLE: Record<TFinanceArticle, TReconcileAccrualLine | null> = {
  sales: 'sales',
  returns: 'returns',
  compensations: 'compensations',
  subsidies: 'compensations',
  other_income: 'compensations',
  commission: 'commission',
  delivery_to_buyer: 'logistics',
  reverse_logistics: 'logistics',
  storage: 'logistics',
  acceptance: 'logistics',
  processing: 'logistics',
  acquiring: 'other_services',
  promotion: 'other_services',
  paid_options: 'other_services',
  penalties: 'other_services',
  withholdings: 'other_services',
  subscription: 'other_services',
  other_services: 'other_services',
  bonus_payment: null,
  promotion_report: null,
  unknown: 'unknown',
};

/**
 * Лист отчёта услуг ЯМ → статья журнала. Листы сводной строки — та же карта,
 * что расшифровка акта (`YM_ACT_SUMMARY_SHEETS`); листы «по заказу» — по
 * названию услуги строки (`YM_WITHHELD_SERVICE_SUB`). Лист вне карты — его
 * сумму не на что положить, и статьи акта честно «недостаточно данных».
 */
export const YM_RECONCILE_SHEET_ARTICLE: Readonly<Record<string, TFinanceArticle>> = {
  ...YM_ACT_SUMMARY_SHEETS,
  placement: 'commission',
  delivery: 'delivery_to_buyer',
  crossregional_delivery: 'delivery_to_buyer',
  payment_accepting: 'acquiring',
  payment_transfer: 'acquiring',
  boost: 'promotion',
  loyalty_and_reviews: 'promotion',
};

// ─── Вход ───────────────────────────────────────────────────────────────────

export type TReconcileOperationSource = 'journal' | 'manual';

/** Строка реестра — журнал или ручная операция, даты уже днями по Москве. */
export interface IAccountingReconcileOperation {
  id: string;
  source: TReconcileOperationSource;
  orderId: string | null;
  article: TFinanceArticle;
  subArticle: TAccountingSubArticle | null;
  /** Со знаком: «+» — деньги продавцу, «−» — удержание. */
  amountKopecks: number;
  /** «ГГГГ-ММ-ДД» начисления. */
  accruedOn: string;
  /** «ГГГГ-ММ-ДД» акта; null — строка не из акта. */
  actDay: string | null;
  bankOrderId: string | null;
  bankSumKopecks: number | null;
  /** «ГГГГ-ММ-ДД» выплаты. */
  paidOn: string | null;
  serviceName: string | null;
  /** Расшифровка сводной строки акта по статьям (jsonb как есть). */
  breakdown?: unknown;
}

/** Акт месяца и его отчёт услуг. */
export interface IAccountingReconcileAct {
  actDay: string;
  /** Итог отчёта услуг, стоимость — «+». null — отчёта нет. */
  totalKopecks: number | null;
  /** Лист → копейки («+»). null — отчёта нет. */
  sheets: Readonly<Record<string, number>> | null;
}

/** Сальдо площадки за месяц, копейки. accrued/closing null — площадка их не отдала. */
export interface IAccountingReconcileBalance {
  openingKopecks: number;
  accruedKopecks: number | null;
  paymentsKopecks: number;
  closingKopecks: number | null;
}

export interface IAccountingReconcileInput {
  period: IFinancePeriod;
  /** Площадка; по умолчанию ЯМ. */
  marketplace?: TFinanceMarketplace;
  /** Сальдо Ozon за месяц (только Ozon); null — не загружено. */
  balance?: IAccountingReconcileBalance | null;
  /** Живые строки окна вокруг месяца (журнал) и ручные операции месяца. */
  operations: readonly IAccountingReconcileOperation[];
  /** Акты, строки которых лежат в отчёте месяца. */
  acts: readonly IAccountingReconcileAct[];
  /** Месяц прошёл по Москве. */
  closed: boolean;
  /** Загружен ли журнал месяца и соседей (строки поручения лежат в M−1…M+1). */
  loaded: { month: boolean; prev: boolean; next: boolean };
  /** Последний успех загрузки — «данные на». */
  dataAsOf: Date | null;
  now: Date;
}

// ─── Выход ──────────────────────────────────────────────────────────────────

export type TReconcileLineStatus = 'matched' | 'mismatch' | 'no_document';

/** Почему операция — кандидат разницы. */
export type TReconcileCandidateReason = 'duplicate' | 'other_date' | 'no_pair';

export const RECONCILE_CANDIDATE_REASON_LABEL: Record<TReconcileCandidateReason, string> = {
  duplicate: 'Дубль',
  other_date: 'Другая дата',
  no_pair: 'Нет пары в документе',
};

export interface IReconcileCandidate {
  operationId: string;
  source: TReconcileOperationSource;
  reason: TReconcileCandidateReason;
  orderId: string | null;
  article: TFinanceArticle;
  subArticle: TAccountingSubArticle | null;
  amountKopecks: number;
  accruedOn: string;
  actDay: string | null;
  paidOn: string | null;
  serviceName: string | null;
  /** Подпись для продавца: услуга, иначе подстатья, иначе статья. */
  title: string;
  /** |сумма| = |разница| — первая догадка. */
  matchesDifference: boolean;
}

export interface IReconcileCandidates {
  items: IReconcileCandidate[];
  /** Всего кандидатов; в `items` — не больше `MAX_FINDING_OPERATION_REFS`. */
  count: number;
}

export interface IReconcileLineResult {
  line: TReconcileLine;
  title: string;
  document: TReconcileDocument | null;
  basis: TReconcileBasis;
  registryKopecks: number;
  /** В том числе ручными операциями. */
  manualKopecks: number;
  operationCount: number;
  documentKopecks: number | null;
  /** Реестр − документ; null — документа нет. */
  differenceKopecks: number | null;
  status: TReconcileLineStatus;
  /** Почему документа нет — текстом для продавца. */
  reason: string | null;
  candidates: IReconcileCandidates;
}

export interface IReconcileActResult {
  actDay: string;
  /** −Σ живых строк дня акта по всему окну журнала, «+» — стоимость услуг. */
  registryKopecks: number;
  documentKopecks: number | null;
  differenceKopecks: number | null;
  status: TReconcileLineStatus;
  /** Листы отчёта вне карты листов. */
  unknownSheets: string[];
}

export interface IReconcilePaymentOrderResult {
  bankOrderId: string;
  paidOn: string;
  registryKopecks: number;
  documentKopecks: number | null;
  differenceKopecks: number | null;
  status: TReconcileLineStatus;
  operationCount: number;
  reason: string | null;
}

export interface IReconcileStoreLevelRow {
  operationId: string;
  source: TReconcileOperationSource;
  article: TFinanceArticle;
  subArticle: TAccountingSubArticle | null;
  amountKopecks: number;
  accruedOn: string;
  serviceName: string | null;
  title: string;
}

export type TReconcileStatus = 'reconciled' | 'discrepancies' | 'insufficient_data';

export const RECONCILE_STATUS_LABEL: Record<TReconcileStatus, string> = {
  reconciled: 'Сверено',
  discrepancies: 'Есть расхождения',
  insufficient_data: 'Недостаточно данных',
};

export interface IAccountingReconcileResult {
  period: IFinancePeriod;
  marketplace: TFinanceMarketplace;
  status: TReconcileStatus;
  /** Сверено не всё: у части статей документа нет. */
  partial: boolean;
  /** Почему месяц «недостаточно данных» — строками для продавца. */
  notes: string[];
  reconciledAt: string;
  dataAsOf: string | null;
  lines: IReconcileLineResult[];
  acts: IReconcileActResult[];
  paymentOrders: IReconcilePaymentOrderResult[];
  /** Строки месяца без номера заказа — уровень магазина, не теряются. */
  storeLevel: { items: IReconcileStoreLevelRow[]; count: number; totalKopecks: number };
  /** Несопоставленных с заказом операций месяца. */
  unmatchedCount: number;
  /** Кандидатов разницы по всем статьям. */
  candidateCount: number;
  /** Заказы, чьи операции — кандидаты разницы (для карточки заказа, TASK-223). */
  discrepantOrderIds: string[];
}

// ─── Расчёт ─────────────────────────────────────────────────────────────────

type TOp = IAccountingReconcileOperation;

const inPeriod = (day: string | null, period: IFinancePeriod) =>
  !!day && day >= period.from && day <= period.to;

const isMoney = (op: TOp) => FINANCE_ARTICLE_META[op.article].group !== 'reference';

const sum = (ops: readonly TOp[]) => ops.reduce((acc, op) => acc + op.amountKopecks, 0);

const differs = (difference: number) => Math.abs(difference) > RECONCILE_TOLERANCE_KOPECKS;

/** Строка с расшифровкой → по части на статью (та же функция, что у P&L). */
function expanded(ops: readonly TOp[]): TOp[] {
  return expandBreakdown(ops) as TOp[];
}

const lineOf = (op: TOp) => RECONCILE_LINE_OF_ARTICLE[op.article];

/** Подпись строки: услуга, иначе подстатья (кроме «не распознано»), иначе статья. */
function titleOf(op: TOp): string {
  if (op.serviceName) return op.serviceName;
  if (op.subArticle && op.subArticle !== 'unknown')
    return ACCOUNTING_SUB_ARTICLE_TITLE[op.subArticle];
  return FINANCE_ARTICLE_META[op.article].title;
}

/** Ключ «та же операция дважды»: заказ, статья, подстатья, услуга, сумма, день. */
const duplicateKey = (op: TOp) =>
  [op.orderId, op.article, op.subArticle, op.serviceName, op.amountKopecks, op.accruedOn].join('|');

/** id операций, повторяющих более раннюю (первая остаётся «настоящей»). */
function duplicateIds(ops: readonly TOp[]): Set<string> {
  const seen = new Set<string>();
  const result = new Set<string>();
  for (const op of [...ops].sort((a, b) => a.id.localeCompare(b.id))) {
    if (op.source !== 'journal') continue;
    const key = duplicateKey(op);
    if (seen.has(key)) result.add(op.id);
    else seen.add(key);
  }
  return result;
}

function candidateOf(op: TOp, reason: TReconcileCandidateReason, difference: number) {
  return {
    operationId: op.id,
    source: op.source,
    reason,
    orderId: op.orderId,
    article: op.article,
    subArticle: op.subArticle,
    amountKopecks: op.amountKopecks,
    accruedOn: op.accruedOn,
    actDay: op.actDay,
    paidOn: op.paidOn,
    serviceName: op.serviceName,
    title: titleOf(op),
    matchesDifference: Math.abs(op.amountKopecks) === Math.abs(difference),
  } satisfies IReconcileCandidate;
}

/**
 * Кандидаты разницы: дубли, строки с другой датой документа, ручные (Маркет
 * их не знает) и строки, равные разнице по модулю. Первыми — равные разнице,
 * дальше по |сумме|. Одна операция — один раз, по самой сильной причине.
 */
function candidatesOf(
  inBasis: readonly TOp[],
  otherDate: readonly TOp[],
  difference: number,
): { list: IReconcileCandidates; all: IReconcileCandidate[] } {
  const dups = duplicateIds(inBasis);
  const picked = new Map<string, IReconcileCandidate>();
  for (const op of inBasis) {
    if (dups.has(op.id)) picked.set(op.id, candidateOf(op, 'duplicate', difference));
  }
  for (const op of otherDate) {
    if (!picked.has(op.id)) picked.set(op.id, candidateOf(op, 'other_date', difference));
  }
  for (const op of inBasis) {
    if (picked.has(op.id)) continue;
    const matches = Math.abs(op.amountKopecks) === Math.abs(difference);
    if (op.source === 'manual' || matches) {
      picked.set(op.id, candidateOf(op, 'no_pair', difference));
    }
  }
  const all = [...picked.values()].sort(
    (a, b) =>
      Number(b.matchesDifference) - Number(a.matchesDifference) ||
      Math.abs(b.amountKopecks) - Math.abs(a.amountKopecks) ||
      a.operationId.localeCompare(b.operationId),
  );
  return { list: { items: all.slice(0, MAX_FINDING_OPERATION_REFS), count: all.length }, all };
}

const NO_CANDIDATES: IReconcileCandidates = { items: [], count: 0 };

function lineResult(
  marketplace: TFinanceMarketplace,
  line: TReconcileLine,
  ops: readonly TOp[],
  documentKopecks: number | null,
  reason: string | null,
): Omit<IReconcileLineResult, 'candidates'> {
  const meta = RECONCILE_LINE_META[line];
  const document = RECONCILE_LINE_DOCUMENT[marketplace][line];
  const registryKopecks = sum(ops);
  const differenceKopecks = documentKopecks === null ? null : registryKopecks - documentKopecks;
  let status: TReconcileLineStatus = 'no_document';
  if (differenceKopecks !== null) status = differs(differenceKopecks) ? 'mismatch' : 'matched';
  return {
    line,
    title: meta.title,
    document,
    // Без актов статьи акта считаются по дню начисления, как остальные.
    basis: meta.basis === 'act_days' && document !== 'act' ? 'accrued_in_month' : meta.basis,
    registryKopecks,
    manualKopecks: sum(ops.filter((op) => op.source === 'manual')),
    operationCount: ops.length,
    documentKopecks,
    differenceKopecks,
    status,
    reason: status === 'no_document' ? reason : null,
  };
}

/** Почему у статьи начислений нет документа — по площадке. */
const NO_ACCRUAL_DOCUMENT: Record<TFinanceMarketplace, string> = {
  ym: 'Отчёта о реализации Маркета в сервисе нет — сверить не с чем',
  ozon:
    'Отчёта о реализации Ozon в сервисе нет — по статьям сверить не с чем; ' +
    'итог начислений и остаток сверяются с сальдо Ozon',
  wb:
    'Отчёт реализации WB — источник самого журнала, независимого документа WB ' +
    'в сервисе нет — сверить не с чем',
};

/** Почему у выплат нет документа (у ЯМ документ — поручения). */
const NO_PAYOUT_DOCUMENT: Record<'ozon' | 'wb', string> = {
  ozon:
    'Ozon выплачивает одной суммой за день, без номера и состава: строки разложены ' +
    'по выплатам по очереди — сверять их с выплатой значило бы сверять с собой',
  wb:
    'Сумма выплаты WB считается из тех же строк отчёта реализации — независимого ' +
    'документа нет, сверить не с чем',
};

/** Почему у остатка нет документа (у Ozon документ — сальдо, если загружено). */
const NO_BALANCE_DOCUMENT: Record<TFinanceMarketplace, string> = {
  ym: 'Сальдо взаиморасчётов Маркет в сервис не отдаёт — сверить не с чем',
  ozon: 'Сальдо Ozon за месяц не загружено — сверить не с чем',
  wb: 'Сальдо взаиморасчётов за месяц WB не отдаёт — сверить не с чем',
};

/** Документ Ozon за месяц: начислено и исходящее сальдо, или почему их нет. */
function balanceDocument(balance: IAccountingReconcileBalance | null | undefined): {
  accrued: number | null;
  closing: number | null;
  accruedReason: string;
  closingReason: string;
} {
  const missing = NO_BALANCE_DOCUMENT.ozon;
  if (!balance) {
    return { accrued: null, closing: null, accruedReason: missing, closingReason: missing };
  }
  return {
    accrued: balance.accruedKopecks,
    closing: balance.closingKopecks,
    accruedReason: 'Ozon не отдал начисления в сальдо месяца — сверить не с чем',
    closingReason: 'Ozon не отдал исходящее сальдо месяца — сверить не с чем',
  };
}

/** Документ статей акта: −Σ листов статьи, или причина, почему его нет. */
function actDocument(acts: readonly IAccountingReconcileAct[]): {
  byLine: Map<TReconcileAccrualLine, number> | null;
  reason: string | null;
  unknownSheets: string[];
} {
  if (!acts.length) {
    return { byLine: null, reason: 'Актов за месяц в журнале нет', unknownSheets: [] };
  }
  const missing = acts.filter((a) => a.sheets === null).map((a) => a.actDay);
  const unknownSheets = new Set<string>();
  const byLine = new Map<TReconcileAccrualLine, number>();
  for (const act of acts) {
    for (const [sheet, kopecks] of Object.entries(act.sheets ?? {})) {
      const article = YM_RECONCILE_SHEET_ARTICLE[sheet];
      const line = article ? RECONCILE_LINE_OF_ARTICLE[article] : null;
      if (!line) {
        unknownSheets.add(sheet);
        continue;
      }
      // Стоимость в листе «+», удержание в журнале «−».
      byLine.set(line, (byLine.get(line) ?? 0) - kopecks);
    }
  }
  if (missing.length) {
    return {
      byLine: null,
      reason: `Нет отчёта об услугах к акту ${missing.join(', ')}`,
      unknownSheets: [...unknownSheets].sort(),
    };
  }
  if (unknownSheets.size) {
    return {
      byLine: null,
      reason: `В отчёте об услугах листы без статьи: ${[...unknownSheets].sort().join(', ')}`,
      unknownSheets: [...unknownSheets].sort(),
    };
  }
  return { byLine, reason: null, unknownSheets: [] };
}

function actResults(
  acts: readonly IAccountingReconcileAct[],
  journal: readonly TOp[],
  unknownSheets: readonly string[],
): IReconcileActResult[] {
  return acts.map((act) => {
    // Как сверка акта текущего механизма: −Σ ВСЕХ живых строк дня акта.
    const registryKopecks = -sum(journal.filter((op) => op.actDay === act.actDay)) + 0;
    const documentKopecks = act.totalKopecks;
    const differenceKopecks = documentKopecks === null ? null : registryKopecks - documentKopecks;
    let status: TReconcileLineStatus = 'no_document';
    if (differenceKopecks !== null) status = differs(differenceKopecks) ? 'mismatch' : 'matched';
    const own = Object.keys(act.sheets ?? {});
    return {
      actDay: act.actDay,
      registryKopecks,
      documentKopecks,
      differenceKopecks,
      status,
      unknownSheets: unknownSheets.filter((s) => own.includes(s)),
    };
  });
}

/** Поручения, выплаченные в месяце: группа строк по `bankOrderId`. */
function paymentOrders(
  journal: readonly TOp[],
  period: IFinancePeriod,
): { results: IReconcilePaymentOrderResult[]; groups: Map<string, TOp[]> } {
  const groups = new Map<string, TOp[]>();
  for (const op of journal) {
    if (!op.bankOrderId) continue;
    const group = groups.get(op.bankOrderId) ?? [];
    group.push(op);
    groups.set(op.bankOrderId, group);
  }
  const results: IReconcilePaymentOrderResult[] = [];
  const kept = new Map<string, TOp[]>();
  for (const [bankOrderId, ops] of groups) {
    const paidOn = ops.map((op) => op.paidOn).find((day): day is string => !!day) ?? null;
    if (!inPeriod(paidOn, period)) continue;
    const money = ops.filter(isMoney);
    const sums = new Set(ops.map((op) => op.bankSumKopecks).filter((s): s is number => s !== null));
    const registryKopecks = sum(money);
    let documentKopecks: number | null = null;
    let reason: string | null = null;
    if (sums.size === 1) documentKopecks = [...sums][0];
    else if (sums.size > 1) reason = 'У строк поручения разные суммы поручения';
    else reason = 'Сумма поручения не указана';
    const differenceKopecks = documentKopecks === null ? null : registryKopecks - documentKopecks;
    let status: TReconcileLineStatus = 'no_document';
    if (differenceKopecks !== null) status = differs(differenceKopecks) ? 'mismatch' : 'matched';
    if (sums.size > 1) status = 'mismatch';
    results.push({
      bankOrderId,
      paidOn: paidOn as string,
      registryKopecks,
      documentKopecks,
      differenceKopecks,
      status,
      operationCount: money.length,
      reason,
    });
    kept.set(bankOrderId, money);
  }
  results.sort(
    (a, b) => a.paidOn.localeCompare(b.paidOn) || a.bankOrderId.localeCompare(b.bankOrderId),
  );
  return { results, groups: kept };
}

/** Кандидаты поручения: дубли, строки с другим днём выплаты, равные разнице. */
function paymentCandidates(
  ops: readonly TOp[],
  order: IReconcilePaymentOrderResult,
): IReconcileCandidate[] {
  const difference = order.differenceKopecks ?? 0;
  const otherDate = ops.filter((op) => op.paidOn !== order.paidOn);
  return candidatesOf(ops, otherDate, difference).all;
}

const sortCandidates = (list: IReconcileCandidate[]): IReconcileCandidates => {
  const sorted = [...list].sort(
    (a, b) =>
      Number(b.matchesDifference) - Number(a.matchesDifference) ||
      Math.abs(b.amountKopecks) - Math.abs(a.amountKopecks) ||
      a.operationId.localeCompare(b.operationId),
  );
  return { items: sorted.slice(0, MAX_FINDING_OPERATION_REFS), count: sorted.length };
};

/**
 * Сверка месяца. Правила:
 * - статьи акта: реестр — строки дней актов месяца (тот же базис, что у сверки
 *   акта текущего механизма) плюс ручные операции статьи за месяц; документ —
 *   −Σ листов статьи в отчёте услуг;
 * - прочие начисления — по дню начисления в месяце, документа нет;
 * - выплаты — Σ денег строк поручений, выплаченных в месяце, против Σ сумм
 *   поручений (ЯМ); у Ozon/WB — Σ строк с выплатой в месяце, документа нет;
 * - остаток — начислено минус выплачено, документа нет; у Ozon с сальдо —
 *   входящее + начислено − выплачено Ozon против исходящего;
 * - допуск — `RECONCILE_TOLERANCE_KOPECKS` (0 копеек).
 */
export function reconcileV2(input: IAccountingReconcileInput): IAccountingReconcileResult {
  const { period } = input;
  const marketplace = input.marketplace ?? 'ym';
  const documents = RECONCILE_LINE_DOCUMENT[marketplace];
  const of = RECONCILE_MARKETPLACE_OF[marketplace];
  const journal = input.operations.filter((op) => op.source === 'journal');
  const manual = input.operations.filter(
    (op) => op.source === 'manual' && inPeriod(op.accruedOn, period),
  );
  const actDays = new Set(input.acts.map((a) => a.actDay));

  // Начисления месяца, по статьям (сводная строка акта — по частям).
  const accruedMonth = expanded(
    [...journal.filter((op) => inPeriod(op.accruedOn, period)), ...manual].filter(isMoney),
  );
  const actBasis = expanded(journal.filter((op) => !!op.actDay && actDays.has(op.actDay)));
  const doc = actDocument(input.acts);

  const discrepant = new Set<string>();
  const lines: IReconcileLineResult[] = [];
  for (const line of RECONCILE_ACCRUAL_LINES) {
    const ofLine = (ops: readonly TOp[]) => ops.filter((op) => lineOf(op) === line);
    if (documents[line] !== 'act') {
      lines.push({
        ...lineResult(
          marketplace,
          line,
          ofLine(accruedMonth),
          null,
          NO_ACCRUAL_DOCUMENT[marketplace],
        ),
        candidates: NO_CANDIDATES,
      });
      continue;
    }
    const manualOfLine = ofLine(manual);
    const inBasis = [...ofLine(actBasis), ...manualOfLine];
    const base = lineResult(
      marketplace,
      line,
      inBasis,
      doc.byLine ? (doc.byLine.get(line) ?? 0) : null,
      doc.reason,
    );
    if (base.status !== 'mismatch') {
      lines.push({ ...base, candidates: NO_CANDIDATES });
      continue;
    }
    // Другая дата: начислена в месяце, а акт — не этого месяца (или без акта);
    // или в акте месяца, а начислена вне месяца.
    const basisIds = new Set(inBasis.map((op) => op.id));
    const otherDate = [
      ...ofLine(accruedMonth).filter((op) => op.source === 'journal' && !basisIds.has(op.id)),
      ...ofLine(actBasis).filter((op) => !inPeriod(op.accruedOn, period)),
    ];
    const { list, all } = candidatesOf(inBasis, otherDate, base.differenceKopecks ?? 0);
    for (const c of all) if (c.orderId) discrepant.add(c.orderId);
    lines.push({ ...base, candidates: list });
  }

  // Итог начислений. У ЯМ и WB документа нет (в нём продажи); у Ozon — начислено по сальдо.
  const ozonDoc = marketplace === 'ozon' ? balanceDocument(input.balance) : null;
  const total = lineResult(
    marketplace,
    'accrual_total',
    accruedMonth,
    ozonDoc ? ozonDoc.accrued : null,
    ozonDoc ? ozonDoc.accruedReason : NO_ACCRUAL_DOCUMENT[marketplace],
  );
  let totalCandidates = NO_CANDIDATES;
  if (total.status === 'mismatch') {
    const { list, all } = candidatesOf(accruedMonth, [], total.differenceKopecks ?? 0);
    for (const c of all) if (c.orderId) discrepant.add(c.orderId);
    totalCandidates = list;
  }
  lines.push({ ...total, candidates: totalCandidates });

  // Выплаты — движение денег. Поручения с суммой — только у ЯМ.
  const payments =
    marketplace === 'ym'
      ? paymentOrders(journal, period)
      : { results: [] as IReconcilePaymentOrderResult[], groups: new Map<string, TOp[]>() };
  let payoutsLine: IReconcileLineResult;
  if (marketplace === 'ym') {
    const paymentCandidatesList: IReconcileCandidate[] = [];
    for (const order of payments.results) {
      if (order.status !== 'mismatch') continue;
      for (const c of paymentCandidates(payments.groups.get(order.bankOrderId) ?? [], order)) {
        paymentCandidatesList.push(c);
        if (c.orderId) discrepant.add(c.orderId);
      }
    }
    const paidOps = [...payments.groups.values()].flat();
    const withDoc = payments.results.filter((o) => o.documentKopecks !== null);
    // Поручений в месяце нет — выплат ноль и в документе; у части нет суммы — документа нет.
    let payoutsDocument: number | null = null;
    if (withDoc.length === payments.results.length) {
      payoutsDocument = withDoc.reduce((acc, o) => acc + (o.documentKopecks ?? 0), 0);
    }
    const payoutsBase = lineResult(
      marketplace,
      'payouts',
      paidOps,
      payoutsDocument,
      'У части поручений месяца нет суммы поручения',
    );
    const anyPaymentMismatch = payments.results.some((o) => o.status === 'mismatch');
    payoutsLine = {
      ...payoutsBase,
      status: anyPaymentMismatch ? 'mismatch' : payoutsBase.status,
      candidates: sortCandidates(paymentCandidatesList),
    };
  } else {
    const paidOps = journal.filter((op) => isMoney(op) && inPeriod(op.paidOn, period));
    payoutsLine = {
      ...lineResult(marketplace, 'payouts', paidOps, null, NO_PAYOUT_DOCUMENT[marketplace]),
      candidates: NO_CANDIDATES,
    };
  }
  lines.push(payoutsLine);

  // Остаток взаиморасчётов. У Ozon с сальдо — входящее + начислено по реестру −
  // выплачено по Ozon против исходящего; иначе начислено минус выплачено, без документа.
  const balance = marketplace === 'ozon' ? input.balance : null;
  const balanceRegistry = balance
    ? balance.openingKopecks + total.registryKopecks - balance.paymentsKopecks
    : total.registryKopecks - payoutsLine.registryKopecks;
  const balanceDocumentKopecks = balance ? (ozonDoc?.closing ?? null) : null;
  const balanceDifference =
    balanceDocumentKopecks === null ? null : balanceRegistry - balanceDocumentKopecks;
  const balanceReason = balance
    ? (ozonDoc?.closingReason ?? null)
    : NO_BALANCE_DOCUMENT[marketplace];
  let balanceStatus: TReconcileLineStatus = 'no_document';
  if (balanceDifference !== null) {
    balanceStatus = differs(balanceDifference) ? 'mismatch' : 'matched';
  }
  lines.push({
    line: 'balance',
    title: RECONCILE_LINE_META.balance.title,
    document: documents.balance,
    basis: RECONCILE_LINE_META.balance.basis,
    registryKopecks: balanceRegistry,
    manualKopecks: total.manualKopecks,
    operationCount: total.operationCount + (balance ? 0 : payoutsLine.operationCount),
    documentKopecks: balanceDocumentKopecks,
    differenceKopecks: balanceDifference,
    status: balanceStatus,
    reason: balanceStatus === 'no_document' ? balanceReason : null,
    candidates: NO_CANDIDATES,
  });

  const acts = actResults(input.acts, journal, doc.unknownSheets);

  // Без номера заказа — уровень магазина.
  const orderless = [
    ...journal.filter((op) => inPeriod(op.accruedOn, period) && isMoney(op)),
    ...manual,
  ].filter((op) => !op.orderId);
  const storeItems = orderless
    .map(
      (op): IReconcileStoreLevelRow => ({
        operationId: op.id,
        source: op.source,
        article: op.article,
        subArticle: op.subArticle,
        amountKopecks: op.amountKopecks,
        accruedOn: op.accruedOn,
        serviceName: op.serviceName,
        title: titleOf(op),
      }),
    )
    .sort(
      (a, b) =>
        a.accruedOn.localeCompare(b.accruedOn) || a.operationId.localeCompare(b.operationId),
    );

  // Итог.
  const notes: string[] = [];
  if (!input.closed) notes.push(`Месяц ещё не закончился — документы ${of} за него не готовы`);
  if (!input.loaded.month) notes.push('Журнал операций за месяц не загружен');
  // Соседние месяцы нужны строкам поручений и актов — они есть только у ЯМ.
  if (marketplace === 'ym' && (!input.loaded.prev || !input.loaded.next)) {
    notes.push('Не загружен журнал соседнего месяца — строки поручений и актов лежат и в нём');
  }
  const documented =
    lines.some((l) => l.status !== 'no_document') || acts.some((a) => a.status !== 'no_document');
  if (!documented) {
    notes.push(`У ${of} нет документа для сверки — суммы реестра показаны без проверки`);
  }
  const insufficient = notes.length > 0;
  const mismatch =
    lines.some((l) => l.status === 'mismatch') || acts.some((a) => a.status === 'mismatch');
  // Какие статьи без документа — видно по их статусу; notes — только о том, почему не сверить месяц.
  const partial = lines.some((l) => l.status === 'no_document');
  let status: TReconcileStatus = 'reconciled';
  if (insufficient) status = 'insufficient_data';
  else if (mismatch) status = 'discrepancies';

  return {
    period,
    marketplace,
    status,
    partial,
    notes,
    reconciledAt: input.now.toISOString(),
    dataAsOf: input.dataAsOf ? input.dataAsOf.toISOString() : null,
    lines,
    acts,
    paymentOrders: payments.results,
    storeLevel: {
      items: storeItems.slice(0, MAX_FINDING_OPERATION_REFS),
      count: storeItems.length,
      totalKopecks: storeItems.reduce((acc, r) => acc + r.amountKopecks, 0),
    },
    unmatchedCount: storeItems.length,
    candidateCount: lines.reduce((acc, l) => acc + l.candidates.count, 0),
    discrepantOrderIds: [...discrepant].sort(),
  };
}

export type TOrderReconcileState = 'reconciled' | 'discrepancy' | 'unknown';

/**
 * Состояние сверки заказа для карточки заказа (TASK-222/223): месяц сверен и
 * операции заказа не среди кандидатов — `reconciled`; среди кандидатов —
 * `discrepancy`; месяц не сверить — `unknown`.
 */
export function orderReconcileStateOf(
  result: Pick<IAccountingReconcileResult, 'status' | 'discrepantOrderIds'>,
  orderId: string,
): TOrderReconcileState {
  if (result.discrepantOrderIds.includes(orderId)) return 'discrepancy';
  return result.status === 'insufficient_data' ? 'unknown' : 'reconciled';
}
