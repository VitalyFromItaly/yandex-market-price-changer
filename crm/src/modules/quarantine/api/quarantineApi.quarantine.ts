import type {
  QuarantineConfirmResponse,
  QuarantineConfirmResult,
  QuarantineView,
  QuarantineViewResponse,
} from '../quarantine.domain';

import { mapConfirmResult, mapQuarantineView } from '../mappers/mapQuarantine.quarantine';

import { http } from '@/shared/http';

const BASE = '/ym/quarantine';

export const quarantineApi = {
  /** Карантин кабинета открытого магазина: ключ — в query, активный магазин бота не трогается. */
  list: async (store: string): Promise<QuarantineView> =>
    mapQuarantineView(
      await http.get<QuarantineViewResponse>(`${BASE}?store=${encodeURIComponent(store)}`),
    ),

  /** ЗАПИСЬ в Маркет: товары возвращаются на витрину. */
  confirm: async (store: string, offerIds: string[]): Promise<QuarantineConfirmResult> =>
    mapConfirmResult(
      await http.post<QuarantineConfirmResponse>(`${BASE}/confirm`, { store, offerIds }),
    ),
};
