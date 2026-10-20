import type {
  MarketCategories,
  MarketCategoriesResponse,
  MarketReportsOptions,
  MarketReportsOptionsResponse,
} from '../market-reports.domain';

import {
  mapMarketCategories,
  mapMarketReportsOptions,
} from '../mappers/mapMarketReports.market-reports';

import { http } from '@/shared/http';

const BASE = '/ym/market-reports';

export const marketReportsApi = {
  /** Отчёты открытого магазина и варианты форм — из констант домена бота. */
  options: async (store: string): Promise<MarketReportsOptions> =>
    mapMarketReportsOptions(
      await http.get<MarketReportsOptionsResponse>(
        `${BASE}/options?store=${encodeURIComponent(store)}`,
      ),
    ),

  /** Категории каталога для «Конкурентной позиции» — это запрос в Маркет. */
  categories: async (store: string): Promise<MarketCategories> =>
    mapMarketCategories(
      await http.get<MarketCategoriesResponse>(
        `${BASE}/categories?store=${encodeURIComponent(store)}`,
      ),
    ),
};
