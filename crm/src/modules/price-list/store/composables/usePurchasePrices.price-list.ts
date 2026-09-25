import type { PurchasePricesPage, PurchasePricesQuery } from '../../price-list.domain';

import { ref } from 'vue';

import { priceListApi } from '../../api/priceListApi.price-list';

import { useBaseState } from '@/shared/composables';

const FIRST_PAGE: PurchasePricesQuery = { q: '', page: 1 };

/**
 * Закупочные цены: страница и поиск. Новый поиск начинает с первой страницы.
 * Ответ, пришедший после более нового запроса, выбрасывается — иначе быстрый
 * набор в поиске показал бы результат для строки, которую уже стёрли.
 */
export function usePurchasePrices() {
  const [page, setPage, isLoading, resetPage, hasPage] = useBaseState<PurchasePricesPage | null>(
    null,
  );
  const [query, setQuery, , resetQuery] = useBaseState<PurchasePricesQuery>(FIRST_PAGE);
  const error = ref<string | null>(null);
  let generation = 0;

  async function load(): Promise<void> {
    const run = ++generation;
    isLoading.value = true;
    error.value = null;
    try {
      const next = await priceListApi.purchasePrices(query.value);
      if (run === generation) setPage(next);
    } catch (caught) {
      if (run === generation) {
        error.value =
          caught instanceof Error ? caught.message : 'Не удалось загрузить закупочные цены';
      }
    } finally {
      if (run === generation) isLoading.value = false;
    }
  }

  async function search(q: string): Promise<void> {
    setQuery({ q: q.trim(), page: 1 });
    await load();
  }

  async function goTo(pageNumber: number): Promise<void> {
    setQuery({ ...query.value, page: pageNumber });
    await load();
  }

  function reset(): void {
    generation += 1;
    resetPage();
    resetQuery();
    error.value = null;
  }

  return { page, query, isLoading, hasPage, error, load, search, goTo, reset };
}
