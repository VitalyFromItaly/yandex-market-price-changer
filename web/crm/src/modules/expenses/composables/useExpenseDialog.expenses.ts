import type { Expense, ExpenseErrors, ExpenseForm } from '../expenses.domain';

import { computed, ref } from 'vue';

import { moscowToday } from '../mappers/mapAllocation.expenses';
import { expenseBody, mapExpenseError, toExpenseForm } from '../mappers/mapExpenses.expenses';
import { useExpensesStore } from '../store/store.expenses';

import { toast } from '@/components/ui/toast';

/**
 * Диалог расхода: новый или правка существующего — одна форма. Проверяет
 * сервер, ошибка встаёт под своё поле; диалог закрывается только после
 * удачной записи.
 */
export function useExpenseDialog(today: () => string = () => moscowToday()) {
  const store = useExpensesStore();

  const open = ref(false);
  const editing = ref<Expense | null>(null);
  const form = ref<ExpenseForm>(toExpenseForm(null, today()));
  const errors = ref<ExpenseErrors>({});
  const busy = ref(false);

  const title = computed(() => (editing.value === null ? 'Новый расход' : 'Изменить расход'));

  function show(expense: Expense | null): void {
    editing.value = expense;
    form.value = toExpenseForm(expense, today());
    errors.value = {};
    open.value = true;
  }

  const openCreate = () => show(null);
  const openEdit = (expense: Expense) => show(expense);

  async function save(): Promise<void> {
    busy.value = true;
    errors.value = {};
    const target = editing.value;
    try {
      const body = expenseBody(form.value);
      if (target === null) await store.create(body);
      else await store.update(target.id, body);
      open.value = false;
      toast.success('Сохранено', target === null ? 'Расход добавлен' : 'Расход изменён');
    } catch (e) {
      errors.value = mapExpenseError(e, 'Не удалось сохранить расход');
    } finally {
      busy.value = false;
    }
  }

  return { open, editing, form, errors, busy, title, openCreate, openEdit, save };
}
