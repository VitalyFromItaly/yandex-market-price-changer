/**
 * Площадки продавца (TASK-127) — лист без импортов, как `telegram-html.ts`.
 *
 * Один список на весь код: товары (`Product.marketplaceSkus`), подключения
 * (`MarketplaceConnection`), адаптеры и CRM. Две копии списка — это ровно та
 * пара, что расходится молча: новая площадка появилась бы в одном месте и
 * отсутствовала в другом.
 */

/** Площадки, с которыми работает продукт. */
export type TMarketplace = 'ym' | 'ozon' | 'wb';

// `Record`, а не литерал массива: компилятор требует каждый член union
// (довод `DRAFT_FIELD_SET`).
const MARKETPLACE_SET: Record<TMarketplace, true> = { ym: true, ozon: true, wb: true };

/** Ключи площадок в порядке подключения: ЯМ → Ozon → WB (решение `tz_finance_scope`). */
export const MARKETPLACES = Object.keys(MARKETPLACE_SET) as TMarketplace[];

/** Ключ площадки из HTTP и путей `$set` — только из белого списка. */
export function isMarketplace(value: unknown): value is TMarketplace {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MARKETPLACE_SET, value);
}

/** Подпись площадки для людей — одна на бэкенд и ответы CRM. */
export const MARKETPLACE_LABEL: Record<TMarketplace, string> = {
  ym: 'Яндекс Маркет',
  ozon: 'Ozon',
  wb: 'Wildberries',
};
