import type {
  TaxLimitBar,
  TaxPeriodRow,
  TaxReconciliationBody,
  TaxReconciliationForm,
  TaxReduction,
  TaxReductionBody,
  TaxReductionForm,
  TaxReductionKind,
  TaxReductionRow,
  TaxYearErrors,
  TaxYearField,
  TaxYearPeriod,
  TaxYearResponse,
} from '../taxes.domain';

import { TAX_YEAR_ERROR_CODE, TAX_YEAR_HISTORY } from '../taxes.domain';

import { ApiError } from '@/shared/http';
import { formatDay, formatKopecks } from '@/shared/utils';

/**
 * Вкладка «Год»: ответ сервера → строки экрана. Чисел здесь не считают — только
 * форматируют; доля дохода от порога — пропорция для полосы, а предупреждения
 * и их пороги приходят с сервера.
 */

const FIELDS: readonly TaxYearField[] = [
  'paidDay',
  'kind',
  'amount',
  'note',
  'accountantIncome',
  'accountantTax',
  'checked',
  'staff',
];

/** Годы выбора: текущий и `TAX_YEAR_HISTORY` прошлых, новые первыми. */
export function taxYearOptions(today: string): { value: number; label: string }[] {
  const current = Number(today.slice(0, 4));
  return Array.from({ length: TAX_YEAR_HISTORY + 1 }, (_, i) => ({
    value: current - i,
    label: String(current - i),
  }));
}

const signed = (kopecks: number) =>
  kopecks > 0 ? `+${formatKopecks(kopecks)}` : formatKopecks(kopecks);

export function toPeriodRow(period: TaxYearPeriod, reductionsApply: boolean): TaxPeriodRow {
  const r = period.reconciliation;
  const diffs = r
    ? [r.incomeDiffKopecks, r.taxDiffKopecks].filter((d): d is number => d !== null)
    : [];
  return {
    key: period.key,
    label: period.label,
    range: `${formatDay(period.from)} — ${formatDay(period.to)}`,
    closed: period.closed,
    income: formatKopecks(period.incomeKopecks),
    tax: formatKopecks(period.taxKopecks),
    minimumApplied: period.minimumApplied,
    reduction: reductionsApply ? formatKopecks(period.reductionKopecks) : null,
    due: formatKopecks(period.dueKopecks),
    advance: formatKopecks(Math.abs(period.advanceKopecks)),
    advanceNegative: period.advanceKopecks < 0,
    reconciliation: r
      ? {
          checked: r.checked,
          diff: diffs.length ? diffs.map(signed).join(' / ') : null,
          hasDiff: diffs.some((d) => d !== 0),
        }
      : null,
  };
}

function toneOf(
  share: number | null,
  forecastShare: number | null,
  approach: number,
): TaxLimitBar['tone'] {
  if (share === null) return 'ok';
  if (share > 1) return 'danger';
  if (share >= approach || (forecastShare !== null && forecastShare > 1)) return 'warn';
  return 'ok';
}

export function toLimitBars(view: TaxYearResponse): TaxLimitBar[] {
  return view.limits.map((limit) => {
    const value = limit.valueKopecks;
    const share = value !== null && value > 0 ? view.incomeKopecks / value : null;
    const forecastShare =
      value !== null && value > 0 && view.forecast !== null
        ? view.forecast.incomeKopecks / value
        : null;
    return {
      key: limit.key,
      label: limit.label,
      value: value === null ? null : formatKopecks(value),
      share,
      forecastShare,
      tone: toneOf(share, forecastShare, view.approachShare),
    };
  });
}

/** Параметр года для справки: суммы — рубли, доли — проценты, нет — «не задано». */
export function formatParam(item: {
  unit: 'kopecks' | 'basisPoints';
  value: number | null;
}): string {
  if (item.value === null) return 'не задано';
  if (item.unit === 'kopecks') return formatKopecks(item.value);
  return `${String(item.value / 100).replace('.', ',')} %`;
}

export function toReductionRow(reduction: TaxReduction): TaxReductionRow {
  return {
    id: reduction.id,
    day: formatDay(reduction.paidDay),
    kind: reduction.kindLabel,
    amount: formatKopecks(reduction.amountKopecks),
    note: reduction.note,
  };
}

const rubInput = (kopecks: number | null) =>
  kopecks === null ? '' : String(kopecks / 100).replace('.', ',');

export function toReductionForm(
  reduction: TaxReduction | null,
  today: string,
  kind: TaxReductionKind = 'insurance_fixed',
): TaxReductionForm {
  if (!reduction) return { paidDay: today, kind, amount: '', note: '' };
  return {
    paidDay: reduction.paidDay,
    kind: reduction.kind,
    amount: rubInput(reduction.amountKopecks),
    note: reduction.note ?? '',
  };
}

export function reductionBody(form: TaxReductionForm): TaxReductionBody {
  return {
    paidDay: form.paidDay,
    kind: form.kind,
    amount: form.amount.trim(),
    note: form.note.trim() || null,
  };
}

export function toReconciliationForm(period: TaxYearPeriod): TaxReconciliationForm {
  const r = period.reconciliation;
  return {
    accountantIncome: rubInput(r?.accountantIncomeKopecks ?? null),
    accountantTax: rubInput(r?.accountantTaxKopecks ?? null),
    checked: r?.checked ?? false,
    note: r?.note ?? '',
  };
}

export function reconciliationBody(form: TaxReconciliationForm): TaxReconciliationBody {
  return {
    accountantIncome: form.accountantIncome.trim() || null,
    accountantTax: form.accountantTax.trim() || null,
    checked: form.checked,
    note: form.note.trim() || null,
  };
}

/** 400 с полем → ошибка под полем; иначе — общая ошибка формы. */
export function mapTaxYearError(error: unknown, fallback: string): TaxYearErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof ApiError &&
    error.code === TAX_YEAR_ERROR_CODE.INVALID_TAX_YEAR_INPUT &&
    error.field !== null &&
    (FIELDS as readonly string[]).includes(error.field)
  ) {
    return { [error.field]: message };
  }
  return { form: message };
}
