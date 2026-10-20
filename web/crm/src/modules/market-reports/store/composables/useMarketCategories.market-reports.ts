import type { MarketCategories } from '../../market-reports.domain';

import { marketReportsApi } from '../../api/marketReportsApi.market-reports';

import { useBaseState } from '@/shared/composables';

/**
 * Категории каталога для «Конкурентной позиции». Это запрос в Маркет (обход
 * каталога), поэтому — только когда открыта эта вкладка.
 */
export function useMarketCategories() {
  const [categories, setCategories, , resetCategories] = useBaseState<MarketCategories | null>(
    null,
  );
  const [categoriesError, setCategoriesError, , resetCategoriesError] = useBaseState<string | null>(
    null,
  );
  const [categoriesLoading, setCategoriesLoading, , resetCategoriesLoading] =
    useBaseState<boolean>(false);
  let loadedFor: string | null = null;

  async function loadCategories(store: string): Promise<void> {
    if (categoriesLoading.value || (categories.value !== null && loadedFor === store)) return;
    setCategoriesLoading(true);
    setCategoriesError(null);
    try {
      setCategories(await marketReportsApi.categories(store));
      loadedFor = store;
    } catch (error) {
      setCategoriesError(
        error instanceof Error ? error.message : 'Не удалось получить категории каталога.',
      );
    } finally {
      setCategoriesLoading(false);
    }
  }

  function reset(): void {
    resetCategories();
    resetCategoriesError();
    resetCategoriesLoading();
    loadedFor = null;
  }

  return { categories, categoriesError, categoriesLoading, loadCategories, reset };
}
