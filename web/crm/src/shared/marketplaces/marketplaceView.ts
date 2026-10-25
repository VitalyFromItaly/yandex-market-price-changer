import type { ChartTone } from '@/components/ui/chart';
import type { MarketplaceKey } from '@/navigation.sections';
import type { DayRange } from '@/shared/utils';
import type { RouteLocationRaw } from 'vue-router';

import { sectionName } from '@/navigation.sections';
import { rangeQuery } from '@/shared/period';

/**
 * Вид площадки, общий для экранов сравнения («Сравнение площадок», дашборд
 * «Площадки»): цвет на графиках и ссылка в её «Финансы». Один цвет площадки на
 * всех экранах — легенда подписывает его словами, цвет не меняется от фильтра.
 */
export const MARKETPLACE_TONE: Record<MarketplaceKey, ChartTone> = {
  ym: 'c1',
  ozon: 'c2',
  wb: 'c3',
};

/** P&L площадки (её адрес, TASK-180) за тот же период. */
export function financeLink(marketplace: MarketplaceKey, period: DayRange): RouteLocationRaw {
  return {
    name: sectionName(marketplace, 'finance'),
    params: { tab: 'pnl' },
    query: rangeQuery(period),
  };
}
