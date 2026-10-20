import type { ProductsTabMeta } from '../products.domain';

/** Вкладки раздела: обе под одной фичей `products`, отдельных гейтов нет. */
export const PRODUCTS_TABS: readonly ProductsTabMeta[] = [
  { key: 'list', label: 'Товары' },
  { key: 'unmatched', label: 'Не сопоставлено' },
];

/** Размер страницы списка — как у закупочных цен «Прайса». */
export const PRODUCTS_PAGE_SIZE = 50;
