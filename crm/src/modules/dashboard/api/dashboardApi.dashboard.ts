import type { PriceListInfo } from '../dashboard.domain';
import type { ProfileResponse } from '@/modules/profile/profile.domain';

import { http } from '@/shared/http';

export const dashboardApi = {
  /**
   * Дата прайса — поле `/profile` (оно уже есть и считается той же функцией,
   * что профиль бота). `/ym/price-list/purchase-prices` тяжелее и закрыт фичей.
   */
  priceList: async (): Promise<PriceListInfo> => {
    const profile = await http.get<ProfileResponse>('/profile');
    return { updatedAt: profile.priceListUpdatedAt };
  },
};
