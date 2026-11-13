/**
 * Результат возвращённого заказа «Финучёта» (TASK-224, ТЗ п.3). Чистая функция:
 * без Nest и базы; строки, операции, себестоимость партий и расходы продавца
 * собирает вызывающий — так же, как для `orderResultOf`.
 *
 * Вход — операции реестра ЭТОГО заказа за все даты (продажа прошлого месяца и
 * возврат в этом — один результат). Операции без номера заказа сюда не входят:
 * это уровень магазина (распределяются общими расходами), а не результат заказа.
 *
 * Выход — строки результата со знаком журнала («+» продавцу, «−» удержание),
 * отдельно стоимость логистики (туда, обратно, обработка, хранение возврата),
 * раскрытие комиссии и эквайринга «удержано / возвращено» и итог = Σ строк.
 *
 * Правила:
 * - подстатья раньше статьи: обработка и хранение возврата у Ozon лежат в
 *   статьях `processing`/`storage`, а обратная логистика у части типов — в
 *   доставке; статья их не отличает;
 * - пригодный и неизвестного состояния возврат восстанавливает партию — не
 *   потеря (решение `accounting_lots_return_condition`); списание — только
 *   повреждённый/утраченный в режиме Б (`writeOffOfLotLines`);
 * - неизвестная себестоимость списания → итог `null`, не 0
 *   (`accounting_unknown_cost_strict`);
 * - повторная упаковка — расход продавца со scope «заказ» (TASK-220), целиком.
 *
 * `returnLossesOf` и «Аналитика возвратов» отсюда не зовутся и не меняются
 * (`accounting_beside_current`).
 */

import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { TAccountingSubArticle } from './accounting-sub-articles';
import type {
  IOrderExpenseShare,
  IOrderResultOperation,
  TOrderLotCostOf,
  TOrderResultReason,
} from './order-result';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TFinanceArticle } from '../finance/finance-articles';

import { RETURN_ASSUMED_FIT_NOTE, isReturnedOrderLine, writeOffOfLotLines } from './order-result';

/** Строка результата возвращённого заказа. */
export type TReturnResultKey =
  | 'revenue'
  | 'delivery'
  | 'reverse_logistics'
  | 'return_processing'
  | 'return_storage'
  | 'commission'
  | 'acquiring'
  | 'other'
  | 'compensations'
  | 'cogs_write_off'
  | 'repacking';

/** Порядок — порядок ключей; подпись — для экрана. */
export const RETURN_RESULT_TITLE: Record<TReturnResultKey, string> = {
  revenue: 'Продажа и возврат платежа',
  delivery: 'Логистика до покупателя',
  reverse_logistics: 'Обратная логистика',
  return_processing: 'Обработка возврата',
  return_storage: 'Хранение возврата',
  commission: 'Комиссия',
  acquiring: 'Эквайринг',
  other: 'Удержания, штрафы и прочие услуги',
  compensations: 'Компенсации',
  cogs_write_off: 'Списание товара',
  repacking: 'Повторная упаковка',
};

const RETURN_RESULT_KEYS = Object.keys(RETURN_RESULT_TITLE) as TReturnResultKey[];

/** Строки, из которых складывается стоимость логистики возврата. */
export const RETURN_LOGISTICS_KEYS: ReadonlySet<TReturnResultKey> = new Set([
  'delivery',
  'reverse_logistics',
  'return_processing',
  'return_storage',
]);

/**
 * Статья журнала → строка результата. `reference` — справочное, вне суммы.
 * `Record` — новая статья без места в результате не скомпилируется.
 */
export const RETURN_RESULT_KEY_OF_ARTICLE: Record<TFinanceArticle, TReturnResultKey | 'reference'> =
  {
    sales: 'revenue',
    returns: 'revenue',
    subsidies: 'revenue',
    compensations: 'compensations',
    other_income: 'compensations',
    commission: 'commission',
    acquiring: 'acquiring',
    delivery_to_buyer: 'delivery',
    reverse_logistics: 'reverse_logistics',
    promotion: 'other',
    storage: 'other',
    acceptance: 'other',
    processing: 'other',
    paid_options: 'other',
    penalties: 'other',
    withholdings: 'other',
    subscription: 'other',
    other_services: 'other',
    unknown: 'other',
    bonus_payment: 'reference',
    promotion_report: 'reference',
  };

/** Подстатьи возврата, которые важнее статьи строки. */
const RETURN_KEY_OF_SUB_ARTICLE: Partial<Record<TAccountingSubArticle, TReturnResultKey>> = {
  reverse_logistics: 'reverse_logistics',
  return_processing: 'return_processing',
  return_storage: 'return_storage',
};

export function returnResultKeyOf(op: IOrderResultOperation): TReturnResultKey | 'reference' {
  const bySub = op.subArticle ? RETURN_KEY_OF_SUB_ARTICLE[op.subArticle] : undefined;
  return bySub ?? RETURN_RESULT_KEY_OF_ARTICLE[op.article];
}

export interface IReturnResultAmount {
  key: TReturnResultKey;
  title: string;
  /** Копейки со знаком журнала; null — неизвестно. */
  kopecks: number | null;
  operationIds: string[];
  reason?: TOrderResultReason;
  note?: string;
  /** Только у повторной упаковки — расходы продавца по отдельности. */
  expenses?: IOrderExpenseShare[];
}

/** Удержано при продаже (−) и возвращено площадкой (+); нетто — невозвращённое. */
export interface IReturnFeeSplit {
  withheldKopecks: number;
  returnedKopecks: number;
  netKopecks: number;
}

export interface IReturnResult {
  marketplace: TFinanceMarketplace;
  orderId: string;
  /** Есть вернувшаяся строка заказа. */
  returned: boolean;
  amounts: IReturnResultAmount[];
  commission: IReturnFeeSplit;
  acquiring: IReturnFeeSplit;
  /** Стоимость логистики: туда + обратно + обработка + хранение возврата, со знаком журнала. */
  logisticsKopecks: number;
  /** Справочные операции (оплачено баллами) — вне суммы. */
  referenceOperationIds: string[];
  /** Финансовый результат = Σ строк; null — неизвестно списание. */
  resultKopecks: number | null;
  unknown: { key: TReturnResultKey; reason: TOrderResultReason | null } | null;
}

export interface IReturnResultInput {
  marketplace: TFinanceMarketplace;
  orderId: string;
  lines: readonly IAccountingOrderLineInput[];
  operations: readonly IOrderResultOperation[];
  /** Режим Б (партии): повреждённый/утраченный возврат списывается. Нет — режим А, списания нет. */
  lotCostOf?: TOrderLotCostOf;
  /** Доли расходов продавца на этот заказ (повторная упаковка, TASK-220). */
  expenses?: readonly IOrderExpenseShare[];
}

const emptySplit = (): IReturnFeeSplit => ({
  withheldKopecks: 0,
  returnedKopecks: 0,
  netKopecks: 0,
});

function addToSplit(split: IReturnFeeSplit, kopecks: number): void {
  if (kopecks < 0) split.withheldKopecks += kopecks;
  else split.returnedKopecks += kopecks;
  split.netKopecks += kopecks;
}

/** Хоть один возврат режима Б с неизвестным состоянием принят пригодным. */
function assumedFit(
  lines: readonly IAccountingOrderLineInput[],
  lotCostOf: TOrderLotCostOf | undefined,
): boolean {
  if (!lotCostOf) return false;
  return lines.some((line) => {
    if (!isReturnedOrderLine(line)) return false;
    const returned = lotCostOf(line).returned;
    return Boolean(returned?.restored && returned.condition === 'unknown');
  });
}

/** Результат возвращённого заказа. */
export function returnResultOf(input: IReturnResultInput): IReturnResult {
  const { lines, lotCostOf } = input;
  const operations = input.operations.filter((op) => op.orderId === input.orderId);

  const byKey = new Map<TReturnResultKey, { kopecks: number; ids: string[] }>();
  const referenceOperationIds: string[] = [];
  const commission = emptySplit();
  const acquiring = emptySplit();
  for (const op of operations) {
    const key = returnResultKeyOf(op);
    if (key === 'reference') {
      if (!referenceOperationIds.includes(op.id)) referenceOperationIds.push(op.id);
      continue;
    }
    const entry = byKey.get(key) ?? { kopecks: 0, ids: [] };
    entry.kopecks += op.amountKopecks;
    // Части одной сводной операции несут её id — в списке он один раз.
    if (!entry.ids.includes(op.id)) entry.ids.push(op.id);
    byKey.set(key, entry);
    if (key === 'commission') addToSplit(commission, op.amountKopecks);
    if (key === 'acquiring') addToSplit(acquiring, op.amountKopecks);
  }

  const amounts: IReturnResultAmount[] = [];
  for (const key of RETURN_RESULT_KEYS) {
    if (key === 'cogs_write_off') {
      const writeOff = lotCostOf ? writeOffOfLotLines(lines, lotCostOf) : null;
      if (writeOff) {
        amounts.push({
          key,
          title: RETURN_RESULT_TITLE[key],
          kopecks: writeOff.kopecks,
          operationIds: [],
          ...(writeOff.reason ? { reason: writeOff.reason } : {}),
        });
      } else if (assumedFit(lines, lotCostOf)) {
        amounts.push({
          key,
          title: RETURN_RESULT_TITLE[key],
          kopecks: 0,
          operationIds: [],
          note: RETURN_ASSUMED_FIT_NOTE,
        });
      }
    } else if (key === 'repacking') {
      const expenses = input.expenses ?? [];
      if (expenses.length) {
        amounts.push({
          key,
          title: RETURN_RESULT_TITLE[key],
          kopecks: expenses.reduce((sum, e) => sum + e.kopecks, 0),
          operationIds: [],
          expenses: [...expenses],
        });
      }
    } else {
      const found = byKey.get(key);
      amounts.push({
        key,
        title: RETURN_RESULT_TITLE[key],
        kopecks: found?.kopecks ?? 0,
        operationIds: found?.ids ?? [],
      });
    }
  }

  const logisticsKopecks = amounts
    .filter((a) => RETURN_LOGISTICS_KEYS.has(a.key))
    .reduce((sum, a) => sum + (a.kopecks ?? 0), 0);
  const missing = amounts.find((a) => a.kopecks === null);

  return {
    marketplace: input.marketplace,
    orderId: input.orderId,
    returned: lines.some(isReturnedOrderLine),
    amounts,
    commission,
    acquiring,
    logisticsKopecks,
    referenceOperationIds,
    resultKopecks: missing ? null : amounts.reduce((sum, a) => sum + (a.kopecks ?? 0), 0),
    unknown: missing ? { key: missing.key, reason: missing.reason ?? null } : null,
  };
}
