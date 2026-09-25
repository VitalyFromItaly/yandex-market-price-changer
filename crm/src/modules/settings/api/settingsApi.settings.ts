import type { PromoBody, ProfitSettingsBody, Settings, SettingsResponse } from '../settings.domain';

import { http } from '@/shared/http';

const BASE = '/ym/settings';

/** Каждый ответ — свежий вид настроек: после записи экран рисуется с сервера, не с формы. */
export const settingsApi = {
  get: (): Promise<Settings> => http.get<SettingsResponse>(BASE),

  saveProfit: (body: ProfitSettingsBody): Promise<Settings> =>
    http.put<SettingsResponse>(BASE, body),

  savePromotion: (brand: string, body: PromoBody): Promise<Settings> =>
    http.put<SettingsResponse>(`${BASE}/promotion/${encodeURIComponent(brand)}`, body),

  disablePromotion: (brand: string): Promise<Settings> =>
    http.delete<SettingsResponse>(`${BASE}/promotion/${encodeURIComponent(brand)}`),
};
