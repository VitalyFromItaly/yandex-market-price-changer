/**
 * Раздел «Налоги» (TASK-123): режим налогообложения, ставка и дата признания
 * дохода — база налога для финансового отчёта. Подписи, предельные ставки и
 * доступные режимы приходят с сервера; проверяет ввод тоже сервер.
 */

export type TaxRegime = 'usn_income' | 'usn_income_minus_expenses' | 'osno' | 'npd';
export type TaxRecognition = 'payment' | 'realization';

export interface TaxSettings {
  regime: TaxRegime;
  /** Сотые доли процента: 600 = 6 %. */
  rateBasisPoints: number;
  recognition: TaxRecognition;
}

export interface TaxRegimeOption {
  key: TaxRegime;
  label: string;
  /** false — режим ещё не поддерживается, в форме не показывается. */
  selectable: boolean;
  defaultRateBasisPoints: number | null;
  maxRateBasisPoints: number | null;
}

export interface TaxesView {
  settings: TaxSettings;
  /** Настроек нет — действует умолчание, продавец его ещё не сохранял. */
  isDefault: boolean;
  updatedAt: string | null;
  regimes: TaxRegimeOption[];
  recognitions: { key: TaxRecognition; label: string }[];
  minimumTaxBasisPoints: number;
}

/** Ответ API совпадает с видом: сервер уже перечисляет поля сам. */
export type TaxesResponse = TaxesView;

/** Строки ввода формы; ставку разбирает сервер. */
export interface TaxForm {
  regime: TaxRegime;
  rate: string;
  recognition: TaxRecognition;
}

export interface TaxBody {
  regime: TaxRegime;
  rate: string;
  recognition: TaxRecognition;
}

export type TaxField = 'regime' | 'rate' | 'recognition';

/** Ошибка под полем формы; `form` — общая, без поля. */
export type TaxErrors = Partial<Record<TaxField | 'form', string>>;

export const TAX_ERROR_CODE = {
  INVALID_TAX_SETTING: 'INVALID_TAX_SETTING',
} as const;

/* ── Налоговый модуль ИП (TASK-146): вкладка «Год» ─────────────────────── */

/** Kind фоновой задачи года (scope `account`, магазина нет). */
export const TAX_YEAR_KIND = 'taxes:year';

/** Вкладку «Год» открывает своя фича поверх `taxes` (решение `tax_year_feature`). */
export const TAX_YEAR_FEATURE = 'tax_year';

export const TAXES_ROUTE_NAME = 'ym-taxes';

/** Сколько прошлых лет предлагает выбор года — как `TAX_YEAR_HISTORY` сервера. */
export const TAX_YEAR_HISTORY = 3;

export interface TaxesTabMeta {
  key: 'settings' | 'year';
  label: string;
  feature?: string;
}

export type TaxYearPeriodKey = 'q1' | 'h1' | 'm9' | 'y';
export type TaxYearWarningLevel = 'approaching' | 'forecast_exceeds' | 'exceeded' | 'info';

export interface TaxYearReconciliation {
  accountantIncomeKopecks: number | null;
  accountantTaxKopecks: number | null;
  checked: boolean;
  note: string | null;
  checkedAt: string | null;
  /** Наше − бухгалтерия; null — бухгалтер суммы не ввёл. */
  incomeDiffKopecks: number | null;
  taxDiffKopecks: number | null;
}

export interface TaxYearPeriod {
  key: TaxYearPeriodKey;
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
  reconciliation: TaxYearReconciliation | null;
}

/** Ответ kind-а `taxes:year` — сервер перечисляет поля сам. */
export interface TaxYearResponse {
  year: number;
  closed: boolean;
  settings: { regimeLabel: string; rateBasisPoints: number; recognitionLabel: string };
  taxIsDefault: boolean;
  hasStaff: boolean;
  reductionsApply: boolean;
  incomeKopecks: number;
  forecast: { incomeKopecks: number; basisDays: number } | null;
  paidKopecks: number;
  balanceKopecks: number;
  limits: { key: 'usn' | 'vat'; label: string; valueKopecks: number | null }[];
  approachShare: number;
  params: {
    sourceNote: string | null;
    items: { key: string; label: string; unit: 'kopecks' | 'basisPoints'; value: number | null }[];
  } | null;
  periods: TaxYearPeriod[];
  warnings: { key: string; level: TaxYearWarningLevel; text: string }[];
}

export interface TaxYearRequest {
  year: number;
}

export type TaxReductionKind = 'insurance_fixed' | 'insurance_extra' | 'other';

export interface TaxReduction {
  id: string;
  paidDay: string;
  kind: TaxReductionKind;
  kindLabel: string;
  amountKopecks: number;
  note: string | null;
}

export interface TaxReductionsView {
  items: TaxReduction[];
  kinds: { key: TaxReductionKind; label: string }[];
  noteMaxLength: number;
}

export interface TaxReductionForm {
  paidDay: string;
  kind: TaxReductionKind;
  amount: string;
  note: string;
}

export interface TaxReductionBody {
  paidDay: string;
  kind: TaxReductionKind;
  amount: string;
  note: string | null;
}

export interface TaxReconciliationForm {
  accountantIncome: string;
  accountantTax: string;
  checked: boolean;
  note: string;
}

export interface TaxReconciliationBody {
  accountantIncome: string | null;
  accountantTax: string | null;
  checked: boolean;
  note: string | null;
}

export type TaxYearField =
  | 'paidDay'
  | 'kind'
  | 'amount'
  | 'note'
  | 'accountantIncome'
  | 'accountantTax'
  | 'checked'
  | 'staff';

export type TaxYearErrors = Partial<Record<TaxYearField | 'form', string>>;

export const TAX_YEAR_ERROR_CODE = {
  INVALID_TAX_YEAR_INPUT: 'INVALID_TAX_YEAR_INPUT',
  TAX_REDUCTION_NOT_FOUND: 'TAX_REDUCTION_NOT_FOUND',
} as const;

/** Строка таблицы периодов — уже отформатированные числа. */
export interface TaxPeriodRow {
  key: TaxYearPeriodKey;
  label: string;
  range: string;
  closed: boolean;
  income: string;
  tax: string;
  minimumApplied: boolean;
  reduction: string | null;
  due: string;
  advance: string;
  advanceNegative: boolean;
  reconciliation: { checked: boolean; diff: string | null; hasDiff: boolean } | null;
}

export interface TaxLimitBar {
  key: 'usn' | 'vat';
  label: string;
  /** null — порог не задан в параметрах года. */
  value: string | null;
  /** Доля дохода от порога, 0…1+; null — порога нет. */
  share: number | null;
  forecastShare: number | null;
  tone: 'ok' | 'warn' | 'danger';
}

export interface TaxReductionRow {
  id: string;
  day: string;
  kind: string;
  amount: string;
  note: string | null;
}
