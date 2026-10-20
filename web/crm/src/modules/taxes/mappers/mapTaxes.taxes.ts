import type {
  TaxBody,
  TaxErrors,
  TaxField,
  TaxForm,
  TaxRecognition,
  TaxRegime,
  TaxesView,
} from '../taxes.domain';

import { TAX_ERROR_CODE } from '../taxes.domain';

import { ApiError } from '@/shared/http';

const FIELDS: readonly TaxField[] = ['regime', 'rate', 'recognition'];

/** Сотые доли процента → «6», «4,5», «0,25» — как продавец вводит ставку. */
export function formatRate(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return String(whole);
  const digits = String(fraction).padStart(2, '0').replace(/0$/, '');
  return `${whole},${digits}`;
}

export function toTaxForm(view: TaxesView): TaxForm {
  return {
    regime: view.settings.regime,
    rate: formatRate(view.settings.rateBasisPoints),
    recognition: view.settings.recognition,
  };
}

export function taxBody(form: TaxForm): TaxBody {
  return { regime: form.regime, rate: form.rate.trim(), recognition: form.recognition };
}

/** Режимы, которые можно выбрать: невыбираемые в форме не показываются вовсе. */
export function regimeOptions(view: TaxesView): { value: TaxRegime; label: string }[] {
  return view.regimes
    .filter((regime) => regime.selectable)
    .map((regime) => ({ value: regime.key, label: regime.label }));
}

export function recognitionOptions(view: TaxesView): { value: TaxRecognition; label: string }[] {
  return view.recognitions.map((item) => ({ value: item.key, label: item.label }));
}

/**
 * Смена режима в форме: ставка становится общей ставкой нового режима, если
 * продавец её не трогал (стоит общая ставка прежнего) — 6 % «Доходов» не
 * должны переехать в «Доходы минус расходы». Введённую руками — не трогаем.
 */
export function withRegime(view: TaxesView, form: TaxForm, regime: TaxRegime): TaxForm {
  if (regime === form.regime) return form;
  const previous = view.regimes.find((item) => item.key === form.regime);
  const next = view.regimes.find((item) => item.key === regime);
  const untouched =
    previous?.defaultRateBasisPoints !== null &&
    previous?.defaultRateBasisPoints !== undefined &&
    form.rate.trim() === formatRate(previous.defaultRateBasisPoints);
  const rate =
    untouched && next?.defaultRateBasisPoints !== null && next?.defaultRateBasisPoints !== undefined
      ? formatRate(next.defaultRateBasisPoints)
      : form.rate;
  return { ...form, regime, rate };
}

export function isSameForm(a: TaxForm, b: TaxForm): boolean {
  return (
    a.regime === b.regime && a.rate.trim() === b.rate.trim() && a.recognition === b.recognition
  );
}

/** Ошибка сервера → под своё поле; прочее — общей плашкой. */
export function mapTaxError(error: unknown, fallback: string): TaxErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof ApiError &&
    error.code === TAX_ERROR_CODE.INVALID_TAX_SETTING &&
    error.field !== null &&
    (FIELDS as readonly string[]).includes(error.field)
  ) {
    return { [error.field]: message };
  }
  return { form: message };
}
