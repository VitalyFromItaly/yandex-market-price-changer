import type { PurchaseBody, PurchasesView, TaxPaymentBody } from '../../purchases.domain';

import { ref } from 'vue';

import { purchasesApi } from '../../api/purchasesApi.purchases';

import { useBaseState } from '@/shared/composables';

/**
 * Закупки и уплаченные налоги: загрузка и записи. Каждая запись заменяет вид
 * ответом сервера. Ошибки записей пробрасываются: под какое поле их ставить,
 * решает форма.
 */
export function usePurchases() {
  const [view, setView, isLoading, resetView, hasView] = useBaseState<PurchasesView | null>(null);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      setView(await purchasesApi.get());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить закупки';
    } finally {
      isLoading.value = false;
    }
  }

  async function apply(request: Promise<PurchasesView>): Promise<void> {
    setView(await request);
  }

  const create = (body: PurchaseBody) => apply(purchasesApi.create(body));
  const update = (id: string, body: PurchaseBody) => apply(purchasesApi.update(id, body));
  const remove = (id: string) => apply(purchasesApi.remove(id));
  const createTax = (body: TaxPaymentBody) => apply(purchasesApi.createTax(body));
  const updateTax = (id: string, body: TaxPaymentBody) => apply(purchasesApi.updateTax(id, body));
  const removeTax = (id: string) => apply(purchasesApi.removeTax(id));

  function reset(): void {
    resetView();
    error.value = null;
  }

  return {
    view,
    isLoading,
    hasView,
    error,
    load,
    create,
    update,
    remove,
    createTax,
    updateTax,
    removeTax,
    reset,
  };
}
