import type { OrderDetailResponse, OrderFeedRow } from '../../order-feed.domain';

import { ref } from 'vue';

import { orderFeedApi } from '../../api/orderFeedApi.order-feed';

import { useBaseState } from '@/shared/composables';

/**
 * Открытый заказ: строка списка показывается сразу, история операций
 * грузится при открытии; поздний ответ прежнего заказа отбрасывается.
 */
export function useOrderDetail() {
  const [opened, setOpened, , resetOpened] = useBaseState<OrderFeedRow | null>(null);
  const [detail, setDetail, isLoading, resetDetail] = useBaseState<OrderDetailResponse | null>(
    null,
  );
  const error = ref<string | null>(null);
  let generation = 0;

  async function open(row: OrderFeedRow): Promise<void> {
    const run = ++generation;
    setOpened(row);
    setDetail(null);
    error.value = null;
    isLoading.value = true;
    try {
      const loaded = await orderFeedApi.detail(row.marketplace, row.id);
      if (run === generation) setDetail(loaded);
    } catch (e) {
      if (run === generation) {
        error.value = e instanceof Error ? e.message : 'Не удалось загрузить операции заказа';
      }
    } finally {
      if (run === generation) isLoading.value = false;
    }
  }

  function close(): void {
    generation++;
    resetOpened();
    resetDetail();
    error.value = null;
  }

  return { opened, detail, isLoading, error, open, close, reset: close };
}
