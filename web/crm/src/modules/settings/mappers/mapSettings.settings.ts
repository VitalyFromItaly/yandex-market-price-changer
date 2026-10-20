import type {
  PromoBody,
  PromoConfig,
  PromoForm,
  ProfitForm,
  ProfitSettingsBody,
  Settings,
  SettingsErrors,
} from '../settings.domain';

import { SETTINGS_ERROR_CODE, brandFieldKey } from '../settings.domain';

import { ApiError } from '@/shared/http';

/** Число — строкой для поля ввода: «23.5» → «23,5», как пишет продавец. */
function fieldOf(value: number): string {
  return String(value).replace('.', ',');
}

/**
 * Строка поля → значение для сервера. Число, если разбирается; иначе строка
 * как есть — отказ с понятным текстом сформулирует сервер (проверка одна на
 * бот и CRM, второй на фронте нет).
 */
function valueOf(text: string): number | string {
  const trimmed = text.trim();
  const parsed = Number(trimmed.replace(',', '.'));
  return trimmed !== '' && Number.isFinite(parsed) ? parsed : trimmed;
}

export function toProfitForm(settings: Settings): ProfitForm {
  return {
    commissionPercent: fieldOf(settings.commissionPercent),
    taxPercent: fieldOf(settings.taxPercent),
    discountPercent: fieldOf(settings.discountPercent),
    brands: Object.fromEntries(
      settings.brands.map((brand) => [brand.key, fieldOf(brand.discountPercent)]),
    ),
  };
}

/**
 * Только изменённые поля. Нетронутый бренд не уходит на сервер: иначе его
 * действующий процент (сейчас — общий) записался бы явным решением и перестал
 * следовать за общей скидкой.
 */
export function profitDiff(settings: Settings, form: ProfitForm): ProfitSettingsBody {
  const body: ProfitSettingsBody = {};

  for (const field of ['commissionPercent', 'taxPercent', 'discountPercent'] as const) {
    const value = valueOf(form[field]);
    if (value !== settings[field]) body[field] = value;
  }

  const brands: Record<string, number | string> = {};
  for (const brand of settings.brands) {
    const text = form.brands[brand.key];
    if (text === undefined) continue;
    const value = valueOf(text);
    if (value !== brand.discountPercent) brands[brand.key] = value;
  }
  if (Object.keys(brands).length > 0) body.brandDiscounts = brands;

  return body;
}

export function isEmptyDiff(body: ProfitSettingsBody): boolean {
  return Object.keys(body).length === 0;
}

export function toPromoForm(config: PromoConfig | null): PromoForm {
  const from = config?.from === undefined ? '' : fieldOf(config.from);
  if (config?.mode === 'tiered') {
    return {
      mode: 'tiered',
      percent: '',
      limit: fieldOf(config.limit),
      below: fieldOf(config.below),
      above: fieldOf(config.above),
      from,
    };
  }
  return {
    mode: 'flat',
    percent: config === null ? '' : fieldOf(config.percent),
    limit: '',
    below: '',
    above: '',
    from,
  };
}

/** Рубли пишут с разрядами и знаком валюты: «10 000 ₽» — это 10000. */
function rublesOf(text: string): number | string {
  return valueOf(text.replace(/[\s\u00a0₽]/g, ''));
}

/** Пустой порог уходит null — «порога нет»; ноль сервер не хранит. */
export function promoBody(form: PromoForm): PromoBody {
  const from = form.from.trim() === '' ? null : rublesOf(form.from);
  if (form.mode === 'tiered') {
    return {
      mode: 'tiered',
      limit: rublesOf(form.limit),
      below: valueOf(form.below),
      above: valueOf(form.above),
      from,
    };
  }
  return { mode: 'flat', percent: valueOf(form.percent), from };
}

/**
 * Ошибка сервера → под какое поле её поставить. По `field` из ответа, а не по
 * тексту: `brandDiscounts.casio` → `brand:casio`, остальные — как есть.
 */
export function mapSettingsError(error: unknown, fallback: string): SettingsErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof ApiError &&
    error.code === SETTINGS_ERROR_CODE.INVALID_SETTING &&
    error.field !== null
  ) {
    const brand = /^brandDiscounts\.(.+)$/.exec(error.field)?.[1];
    return { [brand === undefined ? error.field : brandFieldKey(brand)]: message };
  }
  return { form: message };
}
