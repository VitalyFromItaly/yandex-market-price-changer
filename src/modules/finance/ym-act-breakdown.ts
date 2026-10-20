/**
 * Расшифровка сводной строки акта ЯМ (TASK-155) по отчёту
 * united-marketplace-services.
 *
 * У каждого акта в журнале united-netting есть одна строка «Удержание · Оплата
 * услуг Маркета» без `offerOrServiceName` — одной суммой услуги, которые не
 * удерживаются по заказу: подписка, пуши, вывоз, обработка, хранение возвратов.
 * Классификатор кладёт её в `other_services` (`ym-articles.ts`), а части лежат
 * только в листах отчёта услуг того же акта.
 *
 * Правило снято с живого кабинета 164225008 (дамп 18-10-2026) и сходится до
 * копейки на обоих актах: сводная строка = −Σ `servicePrice` строк сводных
 * листов с тем же `actDate`.
 * - акт 30.09.2026: −51 852 = подписка 16 990 + пуши 26 703 + вывоз 1 124 +
 *   обработка 1 845 + обработка на складе 1 635 + хранение возвратов 3 555;
 * - акт 31.08.2026: −47 203,89 — те же листы плюс персональный менеджер 10 000,
 *   приём излишков 450, доставка до склада назначения 1 521, CPM-буст 24,89.
 *
 * Набор листов меняется от месяца к месяцу, поэтому сводные листы — явная
 * таблица, а не «все, где нет заказа»: обработка и хранение возвратов несут
 * orderId и всё равно идут сводной строкой. Лист, которого нет ни в одной
 * таблице, не угадывается — Σ не сойдётся, и разница станет частью `unknown`
 * с алертом (решение `finance_act_breakdown_field`: без подгонки).
 *
 * Лист: импортирует только листы статей и копеек.
 */

import type { TFinanceArticle } from './finance-articles';
import type { IOperationBreakdownPart } from './operation-breakdown';

import { toKopecks } from './kopecks';

type TRow = Record<string, unknown>;

/** Листы, которые Маркет удерживает сводной строкой акта, → статья (решение `finance_act_breakdown_articles`). */
export const YM_ACT_SUMMARY_SHEETS: Readonly<Record<string, TFinanceArticle>> = {
  business_subscription: 'subscription',
  // Фиксированная плата за пакет обслуживания — того же рода, что подписка.
  personal_manager: 'subscription',
  pushes: 'promotion',
  'cpm-boost': 'promotion',
  export_from_warehouse: 'storage',
  storage_of_returns: 'storage',
  order_processing: 'processing',
  order_processing_on_warehouse: 'processing',
  // Поставка на склад Маркета: приём излишков и доставка грузоместа до склада назначения.
  reception_of_surplus: 'acceptance',
  delivery_via_transit_warehouse: 'acceptance',
};

/**
 * Листы, услуги которых удерживаются строкой ПО ЗАКАЗУ (с названием услуги) и в
 * сводную не входят. Нужны только диагностике: лист ни из одной таблицы —
 * повод дописать правило.
 */
export const YM_ACT_ORDER_SHEETS: readonly string[] = [
  'placement',
  'boost',
  'loyalty_and_reviews',
  'delivery',
  'crossregional_delivery',
  'payment_accepting',
  'payment_transfer',
];

export interface IYmActBreakdown {
  parts: IOperationBreakdownPart[];
  /** Сводная строка минус Σ найденных частей; ≠ 0 — среди частей есть `unknown`. */
  remainderKopecks: number;
  /** Листы отчёта, которых нет ни в одной таблице. */
  unknownSheets: string[];
}

/** «ДД.ММ.ГГГГ» журнала → «ГГГГ-ММ-ДД» отчёта услуг. Иное — null. */
export function ymActDayOf(actDate: unknown): string | null {
  if (typeof actDate !== 'string') return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(actDate.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Первые 10 символов: в листах встречается и «ГГГГ-ММ-ДД», и с временем. */
const serviceActDay = (row: TRow) =>
  typeof row.actDate === 'string' ? row.actDate.trim().slice(0, 10) : null;

const rowsOf = (sheet: unknown): TRow[] => {
  const rows = (sheet as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows)
    ? rows.filter((r): r is TRow => !!r && typeof r === 'object' && !Array.isArray(r))
    : [];
};

/**
 * Сводная строка (сумма в копейках, со знаком журнала) + листы отчёта услуг →
 * части. null — в отчёте нет ни одной строки этого акта: расшифровать нечем,
 * операция остаётся `other_services` целиком (это не расхождение, а не тот
 * отчёт — например, акт прошлого месяца).
 *
 * Стоимость услуги в листе положительна, удержание в журнале — отрицательно,
 * поэтому часть = −servicePrice. Строка листа без числа `servicePrice` не
 * угадывается нулём: её сумма просто не войдёт, и разница уйдёт в остаток.
 */
export function ymActBreakdownOf(
  summaryKopecks: number,
  actDay: string,
  sheets: ReadonlyMap<string, unknown>,
): IYmActBreakdown | null {
  const known = new Set([...Object.keys(YM_ACT_SUMMARY_SHEETS), ...YM_ACT_ORDER_SHEETS]);
  const unknownSheets = [...sheets.keys()].filter((name) => !known.has(name)).sort();

  let actRows = 0;
  const parts: IOperationBreakdownPart[] = [];
  for (const [name, sheet] of sheets) {
    const rows = rowsOf(sheet).filter((row) => serviceActDay(row) === actDay);
    actRows += rows.length;
    const article = YM_ACT_SUMMARY_SHEETS[name];
    if (!article || !rows.length) continue;
    const cost = rows.reduce((sum, row) => sum + (toKopecks(row.servicePrice) ?? 0), 0);
    if (cost !== 0) parts.push({ article, kopecks: -cost + 0, sheet: name });
  }
  if (!actRows) return null;

  parts.sort((a, b) => (a.sheet ?? '').localeCompare(b.sheet ?? ''));
  const remainderKopecks = summaryKopecks - parts.reduce((sum, p) => sum + p.kopecks, 0);
  if (remainderKopecks !== 0) {
    parts.push({ article: 'unknown', kopecks: remainderKopecks, sheet: null });
  }
  return { parts, remainderKopecks, unknownSheets };
}

/** Итог акта в отчёте услуг (TASK-158): Σ по листам, копейки, стоимость услуг — «+». */
export interface IYmActServicesTotal {
  actDay: string;
  totalKopecks: number;
  /** Лист → копейки; листы без строк акта не попадают. */
  sheets: Record<string, number>;
}

/**
 * Σ акта по ВСЕМ листам отчёта услуг — сторона сверки с журналом (TASK-158).
 * Правило снято с дампа 18-10-2026 и сходится до копейки на обоих актах
 * (31.08.2026: 1 012 356,52 ₽; 30.09.2026: 469 903,39 ₽) с −Σ строк united-netting
 * той же actDate.
 *
 * Колонка — `totalAmount`, если она есть у листа (у «Размещения» это стоимость
 * за вычетом скидки за лояльность — в журнале удержание идёт уже за вычетом),
 * иначе `servicePrice`. Сводные листы считаются так же, как в
 * `ymActBreakdownOf`, — у них `totalAmount` нет. null — строк акта нет ни в
 * одном листе: это не нулевой акт, а не тот отчёт.
 */
export function ymActServicesTotalOf(
  actDay: string,
  sheets: ReadonlyMap<string, unknown>,
): IYmActServicesTotal | null {
  let actRows = 0;
  let totalKopecks = 0;
  const bySheet: Record<string, number> = {};
  for (const [name, sheet] of [...sheets].sort(([a], [b]) => a.localeCompare(b))) {
    const all = rowsOf(sheet);
    const column = all.some((row) => 'totalAmount' in row) ? 'totalAmount' : 'servicePrice';
    const rows = all.filter((row) => serviceActDay(row) === actDay);
    if (!rows.length) continue;
    actRows += rows.length;
    const sum = rows.reduce((s, row) => s + (toKopecks(row[column]) ?? 0), 0);
    bySheet[name] = sum;
    totalKopecks += sum;
  }
  return actRows ? { actDay, totalKopecks, sheets: bySheet } : null;
}
