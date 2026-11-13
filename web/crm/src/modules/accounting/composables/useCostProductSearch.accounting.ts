import type { CostProductOption } from '../accounting.domain';

import { ref } from 'vue';

import { useAccountingStore } from '../store/store.accounting';

import { useDebouncedSearch } from '@/shared/composables';

/**
 * Поиск товара для истории закупа v2 (TASK-235): после паузы в наборе — запрос,
 * ответ старого запроса не перетирает свежий. Пустая строка — список пуст, без
 * запроса: выбор, а не каталог.
 */
export function useCostProductSearch() {
  const store = useAccountingStore();
  const found = ref<CostProductOption[]>([]);
  /** Нашлось больше, чем показано, — пусть уточнит. */
  const more = ref(false);
  const searched = ref(false);
  const searching = ref(false);
  const error = ref<string | null>(null);
  let run = 0;

  async function search(q: string): Promise<void> {
    const own = ++run;
    error.value = null;
    if (q.trim().length === 0) {
      found.value = [];
      more.value = false;
      searched.value = false;
      searching.value = false;
      return;
    }
    searching.value = true;
    try {
      const response = await store.findCostProducts(q.trim());
      if (own !== run) return;
      found.value = response.items;
      more.value = response.total > response.items.length;
      searched.value = true;
    } catch (e) {
      if (own === run) error.value = e instanceof Error ? e.message : 'Поиск не удался';
    } finally {
      if (own === run) searching.value = false;
    }
  }

  const { text: query } = useDebouncedSearch('', (q) => void search(q));

  /** Выбор товара: поле и список очищаются, открывается история. */
  function pick(product: CostProductOption): void {
    query.value = '';
    run += 1;
    found.value = [];
    more.value = false;
    searched.value = false;
    searching.value = false;
    void store.selectCostProduct(product);
  }

  return { query, found, more, searched, searching, error, search, pick };
}
