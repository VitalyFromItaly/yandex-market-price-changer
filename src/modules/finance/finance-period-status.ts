/**
 * Статус финансового периода (ТЗ п.4, TASK-112). Лист — без Nest и базы.
 *
 * Правило — решение владельца `finance_period_status_rule` (2026-10-15):
 * «Проверено» — месяц закрыт, последняя загрузка прошла, и в последней версии
 * отчёта нет строк без статьи и корректировок `changed`/`removed`. Нашлось хоть
 * что-то — «Есть расхождения». Всё остальное — «Предварительные данные».
 *
 * TASK-113 ужесточил «Проверено»: у закрытого месяца должна пройти сверка с
 * заказами и выплатами (finance-reconcile.ts) без находок. Сверка не сделана
 * (нет соседнего месяца, сбой Маркета) — «Предварительные данные» с причиной,
 * не «Проверено»: молчание сверки — не доказательство чистоты.
 *
 * TASK-158 добавил сверку акта: Σ отчёта услуг по акту = −Σ строк журнала той же
 * даты акта. Расхождение — находка (`act_mismatch`, «Есть расхождения»), нет
 * отчёта услуг за акт — сверка `unchecked`, то есть не «Проверено». Правило
 * здесь не менялось: оба исхода приходят обычными находками и неполнотой.
 */

export const FINANCE_PERIOD_STATUSES = ['preliminary', 'verified', 'discrepancy'] as const;
export type TFinancePeriodStatus = (typeof FINANCE_PERIOD_STATUSES)[number];

/** Подписи — ровно слова ТЗ; панель и будущий экран «Финансы» берут их отсюда. */
export const FINANCE_PERIOD_STATUS_LABEL: Readonly<Record<TFinancePeriodStatus, string>> = {
  preliminary: 'Предварительные данные',
  verified: 'Проверено',
  discrepancy: 'Есть расхождения',
};

export const FINANCE_IMPORT_OUTCOMES = ['empty', 'unchanged', 'imported', 'failed'] as const;
export type TFinanceImportOutcome = (typeof FINANCE_IMPORT_OUTCOMES)[number];

/** Что показала последняя версия отчёта периода. */
export interface IFinanceVersionCounters {
  documentVersion: number;
  /** Строк без статьи. */
  unknown: number;
  changed: number;
  removed: number;
}

export const FINANCE_RECONCILE_STATES = ['skipped', 'checked', 'unchecked', 'failed'] as const;
export type TFinanceReconcileStateKey = (typeof FINANCE_RECONCILE_STATES)[number];

/**
 * Итог сверки с заказами (TASK-113).
 * - `skipped` — месяц не закрыт, сверка не делалась (решение
 *   `finance_reconcile_closed_only`);
 * - `checked` — сверены заказы, выплаты и статьи;
 * - `unchecked` — заказы и выплаты не сверялись (нет соседнего месяца),
 *   статьи — да, их находки в `discrepancies`;
 * - `failed` — сверка упала (Маркет, база); находок не знаем.
 */
export type TFinanceReconcileState =
  | { state: 'skipped' }
  | { state: 'checked'; discrepancies: number }
  | { state: 'unchecked'; discrepancies: number; reason: string }
  | { state: 'failed'; error: string };

/** Одна попытка загрузки — то, что знает импорт (и сверка после него). */
export type TFinanceImportAttempt =
  | { outcome: 'empty' }
  | ({
      outcome: 'unchanged' | 'imported';
      reconcile: TFinanceReconcileState;
    } & IFinanceVersionCounters)
  | { outcome: 'failed'; error: string };

/** Состояние периода, как оно хранится в finance_periods. */
export interface IFinancePeriodState {
  status: TFinancePeriodStatus;
  lastOutcome: TFinanceImportOutcome;
  documentVersion: number | null;
  unknownCount: number;
  changedCount: number;
  removedCount: number;
  /** Находок сверки с заказами (TASK-113) — список в finance_discrepancies. */
  discrepancyCount: number;
  reconcileState: TFinanceReconcileStateKey | null;
  /** Почему сверка не сделана или упала; null — сделана или не нужна. */
  reconcileNote: string | null;
  error: string | null;
}

/**
 * Период закрыт, когда его последний день уже прошёл по Москве. Строки
 * «ГГГГ-ММ-ДД» сравниваются лексикографически — это и есть календарный порядок.
 */
export function isPeriodClosed(periodTo: string, today: string): boolean {
  return periodTo < today;
}

const NO_COUNTERS = {
  documentVersion: null,
  unknownCount: 0,
  changedCount: 0,
  removedCount: 0,
  discrepancyCount: 0,
  reconcileState: null,
  reconcileNote: null,
};

/**
 * Новое состояние периода после попытки загрузки.
 *
 * - `empty` — Маркет отчёта не отдал: публиковать нечего, «предварительные».
 * - `failed` — статус и счётчики остаются прежними: сбой загрузки ничего не
 *   говорит о данных, и «Проверено» не должно гаснуть от моргнувшей сети.
 *   Ошибка пишется рядом — её покажет карточка.
 * - `imported`/`unchanged` — счётчики последней версии и сверки; незакрытый
 *   период «предварительный», что бы в нём ни было: месяц ещё прирастает.
 *   Закрытый: любая находка — «Есть расхождения» (даже при неполной сверке:
 *   найденное уже найдено), чисто и сверка сделана — «Проверено», чисто, но
 *   сверка не сделана — «Предварительные данные».
 */
export function periodStatusOf(input: {
  periodTo: string;
  today: string;
  attempt: TFinanceImportAttempt;
  previous: IFinancePeriodState | null;
}): IFinancePeriodState {
  const { attempt, previous } = input;

  if (attempt.outcome === 'failed') {
    return {
      ...(previous ?? { status: 'preliminary', ...NO_COUNTERS }),
      lastOutcome: 'failed',
      error: attempt.error,
    };
  }

  if (attempt.outcome === 'empty') {
    return { status: 'preliminary', lastOutcome: 'empty', ...NO_COUNTERS, error: null };
  }

  const { reconcile } = attempt;
  const discrepancyCount = 'discrepancies' in reconcile ? reconcile.discrepancies : 0;
  const clean =
    attempt.unknown === 0 &&
    attempt.changed === 0 &&
    attempt.removed === 0 &&
    discrepancyCount === 0;
  let status: TFinancePeriodStatus = 'preliminary';
  if (isPeriodClosed(input.periodTo, input.today)) {
    if (!clean) status = 'discrepancy';
    else if (reconcile.state === 'checked') status = 'verified';
  }

  let reconcileNote: string | null = null;
  if (reconcile.state === 'unchecked') reconcileNote = reconcile.reason;
  if (reconcile.state === 'failed') reconcileNote = reconcile.error;

  return {
    status,
    lastOutcome: attempt.outcome,
    documentVersion: attempt.documentVersion,
    unknownCount: attempt.unknown,
    changedCount: attempt.changed,
    removedCount: attempt.removed,
    discrepancyCount,
    reconcileState: reconcile.state,
    reconcileNote,
    error: null,
  };
}

/**
 * Статус дня — статус месяца, в который он попадает. Отдельного статуса у дня
 * нет: отчёт площадки грузится периодом, и проверить день отдельно не по чему.
 * День вне всех загруженных периодов — «предварительные».
 */
export function dayStatus(
  day: string,
  periods: readonly { periodFrom: string; periodTo: string; status: TFinancePeriodStatus }[],
): TFinancePeriodStatus {
  const found = periods.find((p) => p.periodFrom <= day && day <= p.periodTo);
  return found?.status ?? 'preliminary';
}

/**
 * Статус произвольного периода по статусам его месяцев (TASK-120): хоть один
 * месяц с расхождениями — «Есть расхождения»; «Проверено» — только если
 * проверены ВСЕ; месяц без загруженного журнала (`null`) — «Предварительные».
 */
export function combinedPeriodStatus(
  statuses: readonly (TFinancePeriodStatus | null)[],
): TFinancePeriodStatus {
  if (statuses.includes('discrepancy')) return 'discrepancy';
  if (statuses.length && statuses.every((status) => status === 'verified')) return 'verified';
  return 'preliminary';
}
