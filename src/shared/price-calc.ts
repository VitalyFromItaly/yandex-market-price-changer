/**
 * Калькулятор цен и прибыли (TASK-139, ТЗ п.8) — прямой расчёт «цена →
 * прибыль» и обратный «прибыль ₽ или рентабельность % → цена».
 *
 * Лист без импортов (паттерн `telegram-html.ts`): его импортируют и бэкенд, и
 * CRM-бандл, поэтому формула одна — экран считает мгновенно в браузере, а
 * тесты бэкенда пинят ту же функцию (решение `price_calc_shared_leaf`).
 *
 * Модель одной штуки. Цена p, скидка d — продажа s = p·(1 − d). От s берутся
 * процентные расходы: комиссия с эквайрингом и продвижение (колонки
 * `commission`/`promotion` unit-экономики). На штуку — закуп, логистика и
 * прочие услуги (F). Налог:
 * - «Доходы» — t·s;
 * - «Доходы минус расходы» — max(t·(s − расходы), m·s), m — минимальный налог
 *   (1 % от доходов, решение `tax_regimes_usn_min`). Минимальный налог годовой,
 *   на штуку это оценка.
 *
 * Прибыль — кусочно-линейная по s: min по ветвям (aᵢ·s − bᵢ). Обратный расчёт
 * решает каждую ветвь и берёт наибольший корень — при растущих ветвях это и
 * есть корень минимума. Рентабельность — прибыль / продажа, как `margin`
 * unit-экономики.
 *
 * Деньги — копейки, ставки — доли (0.23 = 23 %).
 */

export type TPriceCalcTaxMode = 'revenue' | 'profit';

export interface IPriceCalcTax {
  /** revenue — УСН «Доходы», profit — «Доходы минус расходы». */
  mode: TPriceCalcTaxMode;
  rate: number;
  /** Минимальный налог от продажи; у «Доходов» не используется. */
  minRate: number;
}

export interface IPriceCalcInput {
  /** Скидка от цены, доля; продажа = цена × (1 − скидка). */
  discountRate: number;
  /** Комиссия площадки с эквайрингом, доля продажи. */
  commissionRate: number;
  /** Продвижение, доля продажи. */
  promotionRate: number;
  cogsKopecks: number;
  logisticsKopecks: number;
  otherKopecks: number;
  tax: IPriceCalcTax;
}

export interface IPriceCalcResult {
  priceKopecks: number;
  discountKopecks: number;
  /** Продажа после скидки — от неё процентные расходы и рентабельность. */
  saleKopecks: number;
  commissionKopecks: number;
  promotionKopecks: number;
  cogsKopecks: number;
  logisticsKopecks: number;
  otherKopecks: number;
  taxKopecks: number;
  /** Продажа минус все расходы — Σ строк разложения до копейки. */
  profitKopecks: number;
  /** Прибыль / продажа; null — продажи нет. */
  margin: number | null;
}

export type TPriceCalcTarget =
  | { kind: 'profit'; kopecks: number }
  | { kind: 'margin'; rate: number };

/** Почему цену не найти — экран говорит причину, а не 0. */
export type TPriceCalcFailure = 'discount' | 'rates' | 'target';

/** Причины словами — одна таблица на экран CRM и ИИ-инструмент `getPriceFor` (TASK-165). */
export const PRICE_CALC_FAILURE_TEXT: Readonly<Record<TPriceCalcFailure, string>> = {
  discount: 'При скидке 100 % продажи нет — цену не подобрать.',
  rates: 'Процентные расходы съедают всю цену — уменьшите комиссию, продвижение или налог.',
  target: 'Такую рентабельность не получить при этих ставках — снизьте цель.',
};

export type TPriceCalcSolution =
  | { ok: true; priceKopecks: number }
  | { ok: false; reason: TPriceCalcFailure };

const fixedOf = (input: IPriceCalcInput): number =>
  input.cogsKopecks + input.logisticsKopecks + input.otherKopecks;

const percentOf = (input: IPriceCalcInput): number => input.commissionRate + input.promotionRate;

function taxAt(sale: number, input: IPriceCalcInput): number {
  const { mode, rate, minRate } = input.tax;
  if (mode === 'revenue') return rate * sale;
  const taxable = sale - percentOf(input) * sale - fixedOf(input);
  return Math.max(rate * taxable, minRate * sale);
}

/** Прямой расчёт: что останется со штуки при цене `priceKopecks`. */
export function profitAt(priceKopecks: number, input: IPriceCalcInput): IPriceCalcResult {
  const sale = priceKopecks * (1 - input.discountRate);
  const saleKopecks = Math.round(sale);
  const commissionKopecks = Math.round(input.commissionRate * sale);
  const promotionKopecks = Math.round(input.promotionRate * sale);
  const taxKopecks = Math.round(taxAt(sale, input));
  const profitKopecks =
    saleKopecks -
    commissionKopecks -
    promotionKopecks -
    input.cogsKopecks -
    input.logisticsKopecks -
    input.otherKopecks -
    taxKopecks;
  return {
    priceKopecks,
    discountKopecks: priceKopecks - saleKopecks,
    saleKopecks,
    commissionKopecks,
    promotionKopecks,
    cogsKopecks: input.cogsKopecks,
    logisticsKopecks: input.logisticsKopecks,
    otherKopecks: input.otherKopecks,
    taxKopecks,
    profitKopecks,
    margin: saleKopecks > 0 ? profitKopecks / saleKopecks : null,
  };
}

/** Ветви прибыли от продажи s: прибыль = min(a·s − b). */
function branchesOf(input: IPriceCalcInput): { a: number; b: number }[] {
  const r = percentOf(input);
  const fixed = fixedOf(input);
  const { mode, rate, minRate } = input.tax;
  if (mode === 'revenue') return [{ a: 1 - r - rate, b: fixed }];
  return [
    { a: (1 - r) * (1 - rate), b: fixed * (1 - rate) },
    { a: 1 - r - minRate, b: fixed },
  ];
}

/**
 * Обратный расчёт: наименьшая цена в копейках, при которой прибыль штуки не
 * ниже цели (рентабельность — не ниже доли). Округление вверх: прибыль по
 * найденной цене — цель или на копейки больше.
 */
export function priceFor(target: TPriceCalcTarget, input: IPriceCalcInput): TPriceCalcSolution {
  if (!(input.discountRate < 1)) return { ok: false, reason: 'discount' };
  const profit = target.kind === 'profit' ? target.kopecks : 0;
  const margin = target.kind === 'margin' ? target.rate : 0;
  if (target.kind === 'margin' && !(margin < 1)) return { ok: false, reason: 'target' };

  let sale = 0;
  for (const { a, b } of branchesOf(input)) {
    const slope = a - margin;
    if (!(slope > 0)) return { ok: false, reason: margin > 0 && a > 0 ? 'target' : 'rates' };
    sale = Math.max(sale, (profit + b) / slope);
  }
  const price = sale / (1 - input.discountRate);
  // Копеечный шум деления не должен поднимать цену на лишнюю копейку.
  return { ok: true, priceKopecks: Math.max(Math.ceil(price - 1e-6), 0) };
}
