import type { OrderDetailResponse, OrderFeedMarketplace } from '../order-feed.domain';

import { http } from '@/shared/http';

const BASE = '/ym/order-feed';

export const orderFeedApi = {
  /** История операций журнала одного заказа и его прибыль. */
  detail: (marketplace: OrderFeedMarketplace, orderId: string): Promise<OrderDetailResponse> =>
    http.get<OrderDetailResponse>(`${BASE}/${marketplace}/${encodeURIComponent(orderId)}`),
};
