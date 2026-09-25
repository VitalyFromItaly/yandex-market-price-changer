import type { QuarantineConfirmResult } from '../../quarantine.domain';

import { ref } from 'vue';

import { quarantineApi } from '../../api/quarantineApi.quarantine';

/**
 * Подтверждение цен. После ЛЮБОГО исхода список перезапрашивается: Маркет
 * убирает подтверждённые, а при частичном сбое часть уже на витрине — старый
 * список врал бы о ней. Текст частичного сбоя — от сервера («Подтверждено N
 * из M…»), не общее «не получилось».
 */
export function useQuarantineConfirm(reload: (store: string) => Promise<void>) {
  const isConfirming = ref(false);
  const error = ref<string | null>(null);

  async function confirm(
    store: string,
    offerIds: string[],
  ): Promise<QuarantineConfirmResult | null> {
    isConfirming.value = true;
    error.value = null;
    try {
      return await quarantineApi.confirm(store, offerIds);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : 'Не удалось подтвердить цены';
      return null;
    } finally {
      isConfirming.value = false;
      await reload(store);
    }
  }

  function reset(): void {
    isConfirming.value = false;
    error.value = null;
  }

  return { isConfirming, error, confirm, reset };
}
