import type { MarketplaceKey, TopSection } from '@/navigation.sections';
import type { RouteComponent, RouteRecordRaw } from 'vue-router';

import { sectionName, sectionPath } from '@/navigation.sections';

/**
 * Маршрут раздела вне магазина: адрес и имя — из таблицы разделов
 * (`/ozon/finance`, `ozon-finance`; у общих и только-ЯМ разделов — `/ym/...`).
 * `suffix` — хвост адреса после раздела (`/:tab?`).
 */
export function sectionRoute(
  mp: MarketplaceKey,
  section: TopSection,
  component: () => Promise<RouteComponent>,
  title: string,
  suffix = '',
): RouteRecordRaw {
  return {
    path: `${sectionPath(mp, section)}${suffix}`,
    name: sectionName(mp, section),
    component,
    meta: { title },
  };
}
