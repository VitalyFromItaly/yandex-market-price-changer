import type { ExpenseBody, ExpensesView } from '../../expenses.domain';

import { ref } from 'vue';

import { expensesApi } from '../../api/expensesApi.expenses';

import { useBaseState } from '@/shared/composables';

/**
 * Записи расходов и свои категории: загрузка и записи. Каждая запись заменяет
 * вид ответом сервера и зовёт `onChanged` — распределение на период надо
 * перечитать, правка расхода сразу меняет его число. Ошибки записей
 * пробрасываются: под какое поле их ставить, решает форма.
 */
export function useExpenses(onChanged: () => void) {
  const [view, setView, isLoading, resetView, hasView] = useBaseState<ExpensesView | null>(null);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      setView(await expensesApi.get());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить расходы';
    } finally {
      isLoading.value = false;
    }
  }

  async function apply(request: Promise<ExpensesView>): Promise<void> {
    setView(await request);
    onChanged();
  }

  const create = (body: ExpenseBody) => apply(expensesApi.create(body));
  const update = (id: string, body: ExpenseBody) => apply(expensesApi.update(id, body));
  const remove = (id: string) => apply(expensesApi.remove(id));
  const addCategory = (name: string) => apply(expensesApi.addCategory(name));
  const removeCategory = (id: string) => apply(expensesApi.removeCategory(id));

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
    addCategory,
    removeCategory,
    reset,
  };
}
