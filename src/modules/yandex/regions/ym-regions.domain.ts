import type { IProfitOrder, IProfitOrderItem, IProfitPlace } from '../reports/profit';

import { clusterOf, clusterTitle } from '../fby/fby-clusters';

/**
 * Разрез продаж по месту — чистая часть («Топ товаров», src/modules/yandex/README.md
 * «Топ товаров»). Ни сети, ни Mongo: подъём региона до субъекта по цепочке `parent` и
 * подпись кластера по складу.
 */

/** Регион справочника, поднятый до субъекта РФ, — строка кэша `YmRegion`. */
export interface IYmRegionRow {
  regionId: number;
  name: string;
  subject: string | null;
  district: string | null;
}

/** Сырой `RegionDTO`: ровно те поля, что читает подъём. */
interface IRawRegion {
  id?: number;
  name?: string;
  type?: string;
  parent?: IRawRegion;
}

/** Субъект РФ и федеральный округ по типу справочника Маркета (`RegionType`). */
const REGION_TYPE = { SUBJECT: 'REPUBLIC', DISTRICT: 'COUNTRY_DISTRICT' } as const;

/** Подписи пустых значений — продажа без места не теряется, а видна отдельной строкой. */
export const NO_REGION_LABEL = 'Регион не указан';
export const NO_WAREHOUSE_LABEL = 'Склад не указан';
/** Склад продавца (FBS/DBS): кластера Маркета у него нет, отгрузка всегда своя. */
export const OWN_WAREHOUSE_LABEL = 'Свой склад (FBS)';

/** `RegionDTO` с родителями → строка кэша. Без id или имени — `null`. */
export function regionRowOf(raw: unknown): IYmRegionRow | null {
  const region = raw as IRawRegion | undefined;
  if (region?.id == null || !region.name) return null;

  let subject: string | null = null;
  let district: string | null = null;
  // Цепочка идёт от самого региона вверх; сам регион тоже может быть субъектом.
  for (let node: IRawRegion | undefined = region; node; node = node.parent) {
    if (!subject && node.type === REGION_TYPE.SUBJECT && node.name) subject = node.name;
    if (!district && node.type === REGION_TYPE.DISTRICT && node.name) district = node.name;
  }
  return { regionId: Number(region.id), name: region.name, subject, district };
}

/**
 * Подпись региона покупателя: субъект РФ; нет в кэше или нет субъекта в цепочке — имя
 * самого региона (лучше город, чем потеря); нет региона вовсе — `NO_REGION_LABEL`.
 */
export function regionLabel(
  ref: { id?: number; name?: string } | undefined,
  regions: ReadonlyMap<number, IYmRegionRow>,
): string {
  if (ref?.id == null && !ref?.name) return NO_REGION_LABEL;
  const row = ref.id == null ? undefined : regions.get(Number(ref.id));
  return row?.subject ?? row?.name ?? ref.name ?? NO_REGION_LABEL;
}

/**
 * Подпись кластера отгрузки. FBS-магазин — всегда свой склад (в архиве у позиции склад
 * продавца, кластера Маркета у него нет). FBY — кластер по имени склада (`clusterOf`,
 * тот же список, что экран «📦 FBY»); склад вне списка — под своим именем.
 */
export function clusterLabel(
  warehouse: { id?: number; name?: string } | undefined,
  fby: boolean,
): string {
  if (!fby) return OWN_WAREHOUSE_LABEL;
  if (!warehouse?.name) return NO_WAREHOUSE_LABEL;
  const cluster = clusterOf(warehouse.name);
  return cluster ? clusterTitle(cluster) : warehouse.name;
}

/** `placeOf` для `profitOf` поверх кэша регионов и модели размещения магазина. */
export function placeResolver(
  regions: ReadonlyMap<number, IYmRegionRow>,
  fby: boolean,
): (order: IProfitOrder, item: IProfitOrderItem) => IProfitPlace {
  return (order, item) => ({
    region: regionLabel(order?.region, regions),
    cluster: clusterLabel(item?.warehouse, fby),
  });
}

/** Id регионов заказов — для одного запроса к кэшу. */
export function regionIdsOf(orders: readonly IProfitOrder[]): number[] {
  const ids = new Set<number>();
  for (const order of orders ?? []) {
    if (order?.region?.id != null) ids.add(Number(order.region.id));
  }
  return [...ids];
}
