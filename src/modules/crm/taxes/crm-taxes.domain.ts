import type { ITaxReduction } from '../../finance/finance-tax-year-data.service';
import type { ITaxYearReport } from '../../finance/finance-tax-year.service';
import type { ITaxSettingsSnapshot } from '../../finance/finance-tax.service';
import type { TTaxYearWarningLevel } from '../../finance/tax-year';
import type { TTaxReductionKind, TTaxYearPeriod } from '../../finance/tax-year.domain';
import type { TTaxRecognition, TTaxRegime } from '../../finance/tax.domain';

import { TAX_YEAR_THRESHOLDS } from '../../finance/tax-year';
import {
  MAX_TAX_REDUCTION_NOTE_LENGTH,
  TAX_REDUCTION_KINDS,
  TAX_REDUCTION_KIND_LABELS,
  TAX_YEAR_HISTORY,
  TAX_YEAR_PARAM_LABELS,
  TAX_YEAR_PERIOD_LABELS,
} from '../../finance/tax-year.domain';
import {
  DEFAULT_RATE_BY_REGIME,
  MAX_RATE_BY_REGIME,
  SELECTABLE_TAX_REGIMES,
  TAX_RECOGNITION,
  TAX_RECOGNITION_LABELS,
  TAX_REGIMES,
  TAX_REGIME_LABELS,
  USN_MINIMUM_TAX_BASIS_POINTS,
} from '../../finance/tax.domain';

/**
 * Раздел «Налоги» CRM (TASK-123): вид для фронта. Правила ввода — в
 * tax.domain.ts финмодуля; подписи и предельные ставки едут отсюда, копий на
 * фронте нет. Ответ — перечислением полей, `telegramUserId` наружу не уходит.
 */

/** 400: ввод не принят; `field` — под каким полем показать ошибку. */
export const INVALID_TAX_SETTING = 'INVALID_TAX_SETTING';

export interface ICrmTaxRegimeOption {
  key: TTaxRegime;
  label: string;
  /** false — режим показан, но выбрать его пока нельзя (`tax_regimes_usn_min`). */
  selectable: boolean;
  defaultRateBasisPoints: number | null;
  maxRateBasisPoints: number | null;
}

export interface ICrmTaxesView {
  settings: {
    regime: TTaxRegime;
    rateBasisPoints: number;
    recognition: TTaxRecognition;
  };
  isDefault: boolean;
  updatedAt: string | null;
  regimes: ICrmTaxRegimeOption[];
  recognitions: { key: TTaxRecognition; label: string }[];
  minimumTaxBasisPoints: number;
}

export function toCrmTaxesView(snapshot: ITaxSettingsSnapshot): ICrmTaxesView {
  const { settings } = snapshot;
  return {
    settings: {
      regime: settings.regime,
      rateBasisPoints: settings.rateBasisPoints,
      recognition: settings.recognition,
    },
    isDefault: snapshot.isDefault,
    updatedAt: snapshot.updatedAt ? snapshot.updatedAt.toISOString() : null,
    regimes: TAX_REGIMES.map((key) => ({
      key,
      label: TAX_REGIME_LABELS[key],
      selectable: SELECTABLE_TAX_REGIMES.includes(key),
      defaultRateBasisPoints: DEFAULT_RATE_BY_REGIME[key] ?? null,
      maxRateBasisPoints: MAX_RATE_BY_REGIME[key] ?? null,
    })),
    recognitions: TAX_RECOGNITION.map((key) => ({ key, label: TAX_RECOGNITION_LABELS[key] })),
    minimumTaxBasisPoints: USN_MINIMUM_TAX_BASIS_POINTS,
  };
}

/* ── Налоговый модуль ИП (TASK-146): вкладка «Год» ─────────────────────── */

/** Kind фоновой задачи года — уровня аккаунта, журнал бизнесовый. */
export const TAX_YEAR_KIND = 'taxes:year';

/** 400 ввода вкладки «Год»; `field` — под каким полем показать. */
export const INVALID_TAX_YEAR_INPUT = 'INVALID_TAX_YEAR_INPUT';
export const TAX_REDUCTION_NOT_FOUND = 'TAX_REDUCTION_NOT_FOUND';

export const TAX_YEAR_INVALID_TEXT = `Налоговый год — текущий или до ${TAX_YEAR_HISTORY} прошлых`;

export interface ICrmTaxReconciliation {
  accountantIncomeKopecks: number | null;
  accountantTaxKopecks: number | null;
  checked: boolean;
  note: string | null;
  checkedAt: string | null;
  incomeDiffKopecks: number | null;
  taxDiffKopecks: number | null;
}

export interface ICrmTaxYearPeriod {
  key: TTaxYearPeriod;
  label: string;
  from: string;
  to: string;
  fullTo: string;
  closed: boolean;
  incomeKopecks: number;
  taxKopecks: number;
  minimumApplied: boolean;
  reductionsPaidKopecks: number;
  reductionKopecks: number;
  reductionLimitKopecks: number | null;
  dueKopecks: number;
  advanceKopecks: number;
  reconciliation: ICrmTaxReconciliation | null;
}

export interface ICrmTaxYearLimit {
  key: 'usn' | 'vat';
  label: string;
  /** null — в параметрах года не задан. */
  valueKopecks: number | null;
}

export interface ICrmTaxYearParam {
  key: string;
  label: string;
  unit: 'kopecks' | 'basisPoints';
  value: number | null;
}

export interface ICrmTaxYear {
  year: number;
  closed: boolean;
  settings: { regimeLabel: string; rateBasisPoints: number; recognitionLabel: string };
  taxIsDefault: boolean;
  hasStaff: boolean;
  /** Уменьшение на взносы действует — только УСН «Доходы». */
  reductionsApply: boolean;
  incomeKopecks: number;
  forecast: { incomeKopecks: number; basisDays: number } | null;
  paidKopecks: number;
  balanceKopecks: number;
  limits: ICrmTaxYearLimit[];
  approachShare: number;
  /** null — строки года в таблице параметров нет. */
  params: { sourceNote: string | null; items: ICrmTaxYearParam[] } | null;
  periods: ICrmTaxYearPeriod[];
  warnings: { key: string; level: TTaxYearWarningLevel; text: string }[];
}

const PARAM_UNITS: Record<keyof typeof TAX_YEAR_PARAM_LABELS, 'kopecks' | 'basisPoints'> = {
  usnIncomeLimitKopecks: 'kopecks',
  vatThresholdKopecks: 'kopecks',
  insuranceFixedKopecks: 'kopecks',
  insuranceExtraCapKopecks: 'kopecks',
  reductionLimitWithStaffBasisPoints: 'basisPoints',
  maxRateUsnIncomeBasisPoints: 'basisPoints',
  maxRateUsnIncomeMinusExpensesBasisPoints: 'basisPoints',
};

/** Вид года — перечислением полей: строки базы и id продавца наружу не едут. */
export function toCrmTaxYear(report: ITaxYearReport): ICrmTaxYear {
  const { taxYear, params, settings } = report;
  return {
    year: taxYear.year,
    closed: taxYear.closed,
    settings: {
      regimeLabel: TAX_REGIME_LABELS[settings.regime],
      rateBasisPoints: settings.rateBasisPoints,
      recognitionLabel: TAX_RECOGNITION_LABELS[settings.recognition],
    },
    taxIsDefault: report.taxIsDefault,
    hasStaff: report.hasStaff,
    reductionsApply: settings.regime === 'usn_income',
    incomeKopecks: taxYear.incomeKopecks,
    forecast: taxYear.forecast
      ? { incomeKopecks: taxYear.forecast.incomeKopecks, basisDays: taxYear.forecast.basisDays }
      : null,
    paidKopecks: taxYear.paidKopecks,
    balanceKopecks: taxYear.balanceKopecks,
    limits: [
      {
        key: 'usn',
        label: TAX_YEAR_PARAM_LABELS.usnIncomeLimitKopecks,
        valueKopecks: params?.usnIncomeLimitKopecks ?? null,
      },
      {
        key: 'vat',
        label: TAX_YEAR_PARAM_LABELS.vatThresholdKopecks,
        valueKopecks: params?.vatThresholdKopecks ?? null,
      },
    ],
    approachShare: TAX_YEAR_THRESHOLDS.approachShare,
    params: params
      ? {
          sourceNote: params.sourceNote,
          items: (Object.keys(PARAM_UNITS) as (keyof typeof PARAM_UNITS)[]).map((key) => ({
            key,
            label: TAX_YEAR_PARAM_LABELS[key],
            unit: PARAM_UNITS[key],
            value: params[key],
          })),
        }
      : null,
    periods: taxYear.periods.map((p) => ({
      key: p.key,
      label: TAX_YEAR_PERIOD_LABELS[p.key],
      from: p.from,
      to: p.to,
      fullTo: p.fullTo,
      closed: p.closed,
      incomeKopecks: p.incomeKopecks,
      taxKopecks: p.taxKopecks,
      minimumApplied: p.minimumApplied,
      reductionsPaidKopecks: p.reductionsPaidKopecks,
      reductionKopecks: p.reductionKopecks,
      reductionLimitKopecks: p.reductionLimitKopecks,
      dueKopecks: p.dueKopecks,
      advanceKopecks: p.advanceKopecks,
      reconciliation: p.reconciliation
        ? {
            accountantIncomeKopecks: p.reconciliation.accountantIncomeKopecks,
            accountantTaxKopecks: p.reconciliation.accountantTaxKopecks,
            checked: p.reconciliation.checked,
            note: p.reconciliation.note,
            checkedAt: p.reconciliation.checkedAt ? p.reconciliation.checkedAt.toISOString() : null,
            incomeDiffKopecks: p.reconciliation.incomeDiffKopecks,
            taxDiffKopecks: p.reconciliation.taxDiffKopecks,
          }
        : null,
    })),
    warnings: taxYear.warnings.map((w) => ({ key: w.key, level: w.level, text: w.text })),
  };
}

export interface ICrmTaxReductions {
  items: {
    id: string;
    paidDay: string;
    kind: TTaxReductionKind;
    kindLabel: string;
    amountKopecks: number;
    note: string | null;
  }[];
  kinds: { key: TTaxReductionKind; label: string }[];
  noteMaxLength: number;
}

export function toCrmTaxReductions(reductions: readonly ITaxReduction[]): ICrmTaxReductions {
  return {
    items: reductions.map((r) => ({
      id: r.id,
      paidDay: r.paidDay,
      kind: r.kind,
      kindLabel: TAX_REDUCTION_KIND_LABELS[r.kind],
      amountKopecks: r.amountKopecks,
      note: r.note,
    })),
    kinds: TAX_REDUCTION_KINDS.map((key) => ({ key, label: TAX_REDUCTION_KIND_LABELS[key] })),
    noteMaxLength: MAX_TAX_REDUCTION_NOTE_LENGTH,
  };
}
