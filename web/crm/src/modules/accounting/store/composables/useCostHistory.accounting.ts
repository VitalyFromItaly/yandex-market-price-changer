import type {
  CostCorrectionBody,
  CostHistoryView,
  CostProductOption,
  CostProductsResponse,
} from '../../accounting.domain';

import { ref } from 'vue';

import { accountingApi } from '../../api/accountingApi.accounting';

import { useBaseState } from '@/shared/composables';

/**
 * История закупа v2 (TASK-235): выбранный товар, его записи и журнал исправлений.
 * Без кеша — открытие товара всегда спрашивает сервер. Исправление заменяет вид
 * ответом и пробрасывает ошибку: её поставит под поле диалог.
 */
export function useCostHistory() {
  const costProduct = ref<CostProductOption | null>(null);
  const [costHistory, setCostHistory, costHistoryLoading, resetCostHistory] =
    useBaseState<CostHistoryView | null>(null);
  const costHistoryError = ref<string | null>(null);
  /** Валюты формы — приходят с поиском (товар без поиска не выбрать). */
  const costCurrencies = ref<string[]>([]);
  // Смена товара и reset() отрезают ответ запроса, начатого до них.
  let generation = 0;

  /** Порядок ответов поиска держит его композабл; здесь только валюты формы. */
  async function findCostProducts(q: string): Promise<CostProductsResponse> {
    const response = await accountingApi.costProducts(q);
    costCurrencies.value = response.currencies;
    return response;
  }

  function loadCostHistory(): Promise<void> {
    const product = costProduct.value;
    if (product === null) return Promise.resolve();
    const own = ++generation;
    costHistoryLoading.value = true;
    costHistoryError.value = null;
    return accountingApi
      .costHistory(product.id)
      .then((response) => {
        if (own === generation) setCostHistory(response);
      })
      .catch((e: unknown) => {
        if (own !== generation) return;
        costHistoryError.value =
          e instanceof Error ? e.message : 'Не удалось загрузить историю закупа';
      })
      .finally(() => {
        if (own === generation) costHistoryLoading.value = false;
      });
  }

  function selectCostProduct(product: CostProductOption): Promise<void> {
    costProduct.value = product;
    setCostHistory(null);
    return loadCostHistory();
  }

  async function correctCost(body: CostCorrectionBody): Promise<void> {
    const product = costProduct.value;
    if (product === null) return;
    const own = generation;
    const response = await accountingApi.correctCost(product.id, body);
    if (own === generation) setCostHistory(response);
  }

  function reset(): void {
    costProduct.value = null;
    resetCostHistory();
    costHistoryError.value = null;
    costCurrencies.value = [];
    generation += 1;
  }

  return {
    costProduct,
    costHistory,
    costHistoryLoading,
    costHistoryError,
    costCurrencies,
    findCostProducts,
    selectCostProduct,
    loadCostHistory,
    correctCost,
    reset,
  };
}
