import type { AccountingTabMeta } from '../accounting.domain';

import {
  ACCOUNTING_DASHBOARD_FEATURE,
  ACCOUNTING_ORDERS_FEATURE,
  ACCOUNTING_RECONCILE_FEATURE,
  ACCOUNTING_RETURNS_FEATURE,
} from '../accounting.domain';

/**
 * Разделы «Финучёта» — вкладками, а не одной лентой: монтируется только активная,
 * и при входе на страницу стартуют задачи одной вкладки, а не всех разом (все
 * секции сразу выбирали пул Postgres из 10 соединений — `timeout exceeded`).
 * «Себестоимость», «Операции» и «Загрузка данных» открывает зонтик: партии и
 * файл WB внутри них — под своими подфичами.
 */
export const ACCOUNTING_TABS: readonly AccountingTabMeta[] = [
  { key: 'dashboard', label: 'Панель', feature: ACCOUNTING_DASHBOARD_FEATURE },
  { key: 'orders', label: 'Заказы', feature: ACCOUNTING_ORDERS_FEATURE },
  { key: 'returns', label: 'Возвраты', feature: ACCOUNTING_RETURNS_FEATURE },
  { key: 'reconcile', label: 'Сверка', feature: ACCOUNTING_RECONCILE_FEATURE },
  { key: 'costs', label: 'Себестоимость' },
  { key: 'operations', label: 'Операции' },
  { key: 'sync', label: 'Загрузка данных' },
];
