/**
 * Налоговые настройки продавца (TASK-123, ТЗ п.12): режим, ставка, дата
 * признания дохода и проверка ввода. Лист без импортов — правило одно на CRM,
 * движок P&L (TASK-120) и любой будущий канал ввода.
 *
 * Плоская `taxPercent` бота на YandexMarket — другое: это ставка плоской
 * формулы «Прибыли» от суммы продаж, и она остаётся как есть.
 */

/**
 * `osno` и `npd` есть в типе, чтобы таблицы подписей и будущий налоговый
 * модуль (TASK-146) не меняли форму хранения, но выбрать их пока нельзя
 * (решение `tax_regimes_usn_min`): их расчёт в `taxOf` не реализован, и
 * сохранённый режим без расчёта молча дал бы ноль налога.
 */
export const TAX_REGIMES = ['usn_income', 'usn_income_minus_expenses', 'osno', 'npd'] as const;
export type TTaxRegime = (typeof TAX_REGIMES)[number];

export const SELECTABLE_TAX_REGIMES: readonly TTaxRegime[] = [
  'usn_income',
  'usn_income_minus_expenses',
];

export const TAX_REGIME_LABELS: Record<TTaxRegime, string> = {
  usn_income: 'УСН «Доходы»',
  usn_income_minus_expenses: 'УСН «Доходы минус расходы»',
  osno: 'ОСНО',
  npd: 'НПД (самозанятый)',
};

/**
 * Дата признания дохода. `payment` — день поступления денег (кассовый метод
 * УСН, умолчание по решению `tax_recognition_payment_default`); `realization`
 * — день продажи/выкупа.
 */
export const TAX_RECOGNITION = ['payment', 'realization'] as const;
export type TTaxRecognition = (typeof TAX_RECOGNITION)[number];

export const TAX_RECOGNITION_LABELS: Record<TTaxRecognition, string> = {
  payment: 'По дате поступления денег',
  realization: 'По дате реализации',
};

/**
 * Ставка — в сотых долях процента, целым числом (600 = 6 %): регионы снижают
 * ставку до долей процента, а float-проценты в базе и в сравнении «не выше
 * предельной» — лишний повод для 5.999999.
 */
export interface ITaxSettings {
  regime: TTaxRegime;
  rateBasisPoints: number;
  recognition: TTaxRecognition;
}

/** Ставка по умолчанию при выборе режима — общая ставка НК. */
export const DEFAULT_RATE_BY_REGIME: Partial<Record<TTaxRegime, number>> = {
  usn_income: 600,
  usn_income_minus_expenses: 1500,
};

/**
 * Предельная ставка режима: регион может только снизить её, поднять — нет.
 * 0 допустим — налоговые каникулы.
 */
export const MAX_RATE_BY_REGIME: Partial<Record<TTaxRegime, number>> = {
  usn_income: 600,
  usn_income_minus_expenses: 1500,
};

/** Минимальный налог УСН «Доходы минус расходы» — 1 % от доходов (ст. 346.18 НК). */
export const USN_MINIMUM_TAX_BASIS_POINTS = 100;

/** Умолчание для продавца без сохранённых настроек — ALL BEST WATCH (`finance_per_seller`). */
export const DEFAULT_TAX_SETTINGS: ITaxSettings = {
  regime: 'usn_income',
  rateBasisPoints: 600,
  recognition: 'payment',
};

/** `staff` — флаг работников налогового модуля ИП (TASK-146), не форма режима. */
export type TTaxField = 'regime' | 'rate' | 'recognition' | 'staff';

export type TTaxValidation =
  | { ok: true; value: ITaxSettings }
  | { ok: false; field: TTaxField; error: string };

const fail = (field: TTaxField, error: string): TTaxValidation => ({ ok: false, field, error });

export function isTaxRegime(value: unknown): value is TTaxRegime {
  return typeof value === 'string' && (TAX_REGIMES as readonly string[]).includes(value);
}

export function isTaxRecognition(value: unknown): value is TTaxRecognition {
  return typeof value === 'string' && (TAX_RECOGNITION as readonly string[]).includes(value);
}

/**
 * Проценты («6», «4,5», 6.5) → сотые доли процента. Не больше двух знаков
 * после запятой: третий — опечатка, а не ставка. Мусор → null.
 */
export function parseRatePercent(value: unknown): number | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim().replace(/\s/g, '').replace('%', '').replace(',', '.');
  } else {
    return null;
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const whole = Number(m[1]);
  const fraction = Number((m[2] ?? '').padEnd(2, '0'));
  return whole * 100 + fraction;
}

/**
 * Ввод настроек целиком, поверх текущих. Режим и признание — только из
 * списков; ставку можно не присылать: при смене режима тогда берётся его
 * общая ставка, без смены — остаётся прежняя (6 % «Доходов» не должны
 * переехать в «Доходы минус расходы» как 6 %).
 */
export function validateTaxSettingsInput(
  input: Record<string, unknown>,
  current: ITaxSettings,
): TTaxValidation {
  const regime = input.regime === undefined ? current.regime : input.regime;
  if (!isTaxRegime(regime)) return fail('regime', 'Выберите режим налогообложения');
  if (!SELECTABLE_TAX_REGIMES.includes(regime)) {
    return fail('regime', `${TAX_REGIME_LABELS[regime]} пока не поддерживается`);
  }

  const recognition = input.recognition === undefined ? current.recognition : input.recognition;
  if (!isTaxRecognition(recognition)) {
    return fail('recognition', 'Выберите дату признания дохода');
  }

  let rateBasisPoints: number;
  if (input.rate === undefined || input.rate === null || input.rate === '') {
    rateBasisPoints =
      regime === current.regime ? current.rateBasisPoints : (DEFAULT_RATE_BY_REGIME[regime] ?? 0);
  } else {
    const parsed = parseRatePercent(input.rate);
    if (parsed === null) {
      return fail('rate', 'Ставка — число процентов, не больше двух знаков после запятой');
    }
    rateBasisPoints = parsed;
  }
  const max = MAX_RATE_BY_REGIME[regime] ?? 0;
  if (rateBasisPoints > max) {
    return fail('rate', `Ставка для режима ${TAX_REGIME_LABELS[regime]} — не выше ${max / 100} %`);
  }

  return { ok: true, value: { regime, rateBasisPoints, recognition } };
}
