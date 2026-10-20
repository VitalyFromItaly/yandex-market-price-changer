import type {
  ProductCard,
  ProductPurchase,
  ProductsPage,
  ProductsResponse,
  PurchaseBody,
  PurchaseErrors,
  PurchaseForm,
  UnmatchedPage,
  UnmatchedResponse,
} from '../products.domain';

import { BASE_CURRENCY, CURRENCY_LABEL, PRODUCT_ERROR_CODE } from '../constants/purchase.products';

import { ApiError } from '@/shared/http';
import { formatRub } from '@/shared/utils';

const pagesOf = (total: number, limit: number) =>
  Math.max(1, Math.ceil(total / Math.max(1, limit)));

export function mapProductsPage(response: ProductsResponse): ProductsPage {
  return {
    total: response.total,
    totalAll: response.totalAll,
    page: response.page,
    pages: pagesOf(response.total, response.limit),
    brands: response.brands,
    items: response.items,
  };
}

export function mapUnmatchedPage(response: UnmatchedResponse): UnmatchedPage {
  return {
    total: response.total,
    page: response.page,
    pages: pagesOf(response.total, response.limit),
    items: response.items,
  };
}

/** Число без лишних нулей: «12,5», «1 000». */
function formatAmount(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Закуп словами: «1 000 ₽», «12,5 $ × 90 ₽», «… + 40 ₽ доп. расходы». Это
 * запись того, что ввёл продавец, а не расчёт — себестоимость считает сервер.
 */
export function formatPurchase(purchase: ProductPurchase | null): string {
  if (purchase === null) return '—';
  const sign = CURRENCY_LABEL[purchase.currency] ?? purchase.currency;
  let text =
    purchase.currency === BASE_CURRENCY
      ? formatRub(purchase.price)
      : `${formatAmount(purchase.price)} ${sign}`;
  if (purchase.currency !== BASE_CURRENCY && purchase.rate !== null) {
    text += ` × ${formatAmount(purchase.rate)} ₽`;
  }
  if (purchase.extraCosts !== null && purchase.extraCosts > 0) {
    text += ` + ${formatRub(purchase.extraCosts)} доп.`;
  }
  return text;
}

/** «с 17-10-2026» или «с начала» у стартовой записи. */
export function formatValidFrom(validFrom: string | null): string {
  if (validFrom === null) return 'с начала';
  const [year, month, day] = validFrom.split('-');
  return `с ${day}-${month}-${year}`;
}

/** Автор правки: своя — «вы», иначе id; у прайса и стартовой — прочерк. */
export function formatAuthor(author: string | null, me: string | undefined): string {
  if (author === null) return '—';
  return author === me ? 'вы' : author;
}

/** Форма из действующего закупа; нет закупа — пустая, в рублях. */
export function toPurchaseForm(card: ProductCard | null): PurchaseForm {
  const purchase = card?.purchase ?? null;
  const text = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : String(value).replace('.', ',');
  return {
    price: text(purchase?.price),
    currency: purchase?.currency ?? BASE_CURRENCY,
    rate: purchase?.currency === BASE_CURRENCY ? '' : text(purchase?.rate),
    extraCosts: text(purchase?.extraCosts),
  };
}

/** Тело запроса: курс у рублей не отправляется, пустые поля — `null`. */
export function purchaseBody(form: PurchaseForm): PurchaseBody {
  const blank = (value: string) => (value.trim().length === 0 ? null : value.trim());
  return {
    price: form.price.trim(),
    currency: form.currency,
    rate: form.currency === BASE_CURRENCY ? null : blank(form.rate),
    extraCosts: blank(form.extraCosts),
  };
}

const PURCHASE_FIELDS = ['price', 'currency', 'rate', 'extraCosts'] as const;

/** Ошибка сервера — под своё поле; остальное — общей строкой формы. */
export function mapPurchaseError(error: unknown, fallback: string): PurchaseErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof ApiError &&
    error.code === PRODUCT_ERROR_CODE.INVALID_PURCHASE &&
    error.field !== null &&
    (PURCHASE_FIELDS as readonly string[]).includes(error.field)
  ) {
    return { [error.field]: message };
  }
  return { form: message };
}
