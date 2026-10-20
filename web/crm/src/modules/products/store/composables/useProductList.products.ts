import type { ProductsPage, ProductsQuery } from '../../products.domain';

import { ref } from 'vue';

import { productsApi } from '../../api/productsApi.products';

import { useBaseState } from '@/shared/composables';

const FIRST_PAGE: ProductsQuery = { q: '', brand: '', page: 1 };

/**
 * Список товаров: поиск, бренд, страница. Новый поиск или бренд — с первой
 * страницы. Ответ, пришедший после более нового запроса, выбрасывается: иначе
 * быстрый набор показал бы результат для стёртой строки.
 */
export function useProductList() {
  const [page, setPage, isLoading, resetPage] = useBaseState<ProductsPage | null>(null);
  const [query, setQuery, , resetQuery] = useBaseState<ProductsQuery>(FIRST_PAGE);
  const error = ref<string | null>(null);
  let generation = 0;

  async function load(): Promise<void> {
    const run = ++generation;
    isLoading.value = true;
    error.value = null;
    try {
      const next = await productsApi.list(query.value);
      if (run === generation) setPage(next);
    } catch (caught) {
      if (run === generation) {
        error.value = caught instanceof Error ? caught.message : 'Не удалось загрузить товары';
      }
    } finally {
      if (run === generation) isLoading.value = false;
    }
  }

  async function search(q: string): Promise<void> {
    setQuery({ ...query.value, q: q.trim(), page: 1 });
    await load();
  }

  async function filterBrand(brand: string): Promise<void> {
    setQuery({ ...query.value, brand, page: 1 });
    await load();
  }

  async function goTo(pageNumber: number): Promise<void> {
    setQuery({ ...query.value, page: pageNumber });
    await load();
  }

  /**
   * Поиск товара для выбора (диалог привязки): ответ отдаётся, а не кладётся
   * в список — страница раздела под диалогом не должна меняться.
   */
  async function find(q: string, limit: number): Promise<ProductsPage> {
    return await productsApi.list({ q: q.trim(), brand: '', page: 1 }, limit);
  }

  function reset(): void {
    generation += 1;
    resetPage();
    resetQuery();
    error.value = null;
  }

  return { page, query, isLoading, error, load, search, filterBrand, goTo, find, reset };
}
