import { defineStore } from 'pinia';

import { useOrderDetail } from './composables/useOrderDetail.order-feed';
import { useOrderFeedList } from './composables/useOrderFeedList.order-feed';

/** Стор «Ленты заказов» — тонкий фасад над списком и открытым заказом. */
export const useOrderFeedStore = defineStore('order-feed', () => {
  const list = useOrderFeedList();
  const detail = useOrderDetail();
  return {
    ...list,
    opened: detail.opened,
    detail: detail.detail,
    detailLoading: detail.isLoading,
    detailError: detail.error,
    openOrder: detail.open,
    closeOrder: detail.close,
    reset() {
      list.reset();
      detail.reset();
    },
  };
});
