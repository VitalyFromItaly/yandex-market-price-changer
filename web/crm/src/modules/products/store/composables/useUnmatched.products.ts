import type { LinkBody, UnmatchedPage } from '../../products.domain';

import { ref } from 'vue';

import { productsApi } from '../../api/productsApi.products';

import { useBaseState } from '@/shared/composables';

/**
 * Очередь «не сопоставлено»: страница карточек площадок без товара и ручная
 * привязка. Очередь — вывод сервера, а не журнал: после привязки страница
 * перечитывается, строка уходит сама.
 */
export function useUnmatched() {
  const [page, setPage, isLoading, resetPage] = useBaseState<UnmatchedPage | null>(null);
  const error = ref<string | null>(null);
  let generation = 0;

  async function load(pageNumber = page.value?.page ?? 1): Promise<void> {
    const run = ++generation;
    isLoading.value = true;
    error.value = null;
    try {
      const next = await productsApi.unmatched(pageNumber);
      if (run === generation) setPage(next);
    } catch (caught) {
      if (run === generation) {
        error.value =
          caught instanceof Error
            ? caught.message
            : 'Не удалось загрузить несопоставленные карточки';
      }
    } finally {
      if (run === generation) isLoading.value = false;
    }
  }

  /** Привязать карточку к товару; ошибка пробрасывается в диалог. */
  async function link(productId: string, body: LinkBody): Promise<void> {
    await productsApi.link(productId, body);
    await load();
  }

  function reset(): void {
    generation += 1;
    resetPage();
    error.value = null;
  }

  return { page, isLoading, error, load, link, reset };
}
