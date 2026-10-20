import type { TMarketplace } from '../../shared/marketplace';
import type { IInventory } from '../finance/inventory';

import { MARKETPLACE_LABEL } from '../../shared/marketplace';

/**
 * Сборка склада (TASK-142, вынесена из CRM в TASK-152): что собрано о площадках,
 * тексты оговорок и окно скорости. Строки и суммы считает лист
 * `finance/inventory.ts`; читают сборку раздел CRM «Склад» и правила уведомлений.
 */

/** Окно скорости продаж — целые четыре недели, как умолчание базы «Прогнозов». */
export const INVENTORY_BASIS_DAYS = 28;

/** Подписи мест: у каждой площадки своё имя чужого склада. */
export const INVENTORY_PLACE_LABEL: Record<TMarketplace, { seller: string; marketplace: string }> =
  {
    ym: { seller: 'FBS', marketplace: 'FBY' },
    ozon: { seller: 'FBS', marketplace: 'FBO' },
    wb: { seller: 'FBS', marketplace: 'FBW' },
  };

export const OZON_RETURNS_UNAVAILABLE_TEXT =
  'Ozon не отдаёт возвраты отправлений — возвратов в пути здесь нет (а не ноль).';

export const WB_TRANSIT_NOTE =
  'WB: открытый заказ FBW считается «в пути» — промежуточных статусов статистика не знает; ' +
  'отказ при получении FBW виден как отмена, а не возврат.';

export const MARKETPLACE_ORDERS_WINDOW_NOTE =
  'Ozon и WB: в пути и возвраты — по заказам последних 30 дней.';

export const YM_REPORT_CLOSED_TEXT = (report: string) =>
  `Отчёт «${report}» закрыт — эти числа у ЯМ не собирались.`;

export const NOT_CONNECTED_TEXT = (marketplace: TMarketplace) =>
  `${MARKETPLACE_LABEL[marketplace]} не подключён — ключ задаётся в «Подключениях».`;

export const NO_JOURNAL_TEXT = (marketplace: TMarketplace, month: string) =>
  `Журнал ${MARKETPLACE_LABEL[marketplace]} за ${month} не загружен — скорость продаж не посчитана.`;

/** Почему у площадки нет какого-то числа — строкой под таблицей, не нулём. */
export interface IInventoryProblem {
  marketplace: TMarketplace;
  storeName: string | null;
  problem: string;
}

export type TInventoryColumnState = 'ok' | 'not-connected';

export interface IInventoryColumn {
  marketplace: TMarketplace;
  label: string;
  state: TInventoryColumnState;
  places: { seller: string; marketplace: string };
  /** Когда площадка дала остатки; FBY ЯМ — момент съёмки отчёта. */
  takenAt: string | null;
  /** Ozon сообщает резерв, ЯМ и WB — нет: колонку резерва показываем только тогда. */
  hasReserve: boolean;
}

/** Сборка склада целиком: строки листа + что собрано о площадках и чего не хватило. */
export interface IInventorySnapshot {
  inventory: IInventory;
  columns: IInventoryColumn[];
  problems: IInventoryProblem[];
  notes: string[];
}
