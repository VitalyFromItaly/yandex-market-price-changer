import type { Expense, ExpenseCategory } from '../expenses.domain';

import { ref } from 'vue';

import { useExpensesStore } from '../store/store.expenses';

import { toast } from '@/components/ui/toast';

type TTarget =
  | { kind: 'expense'; expense: Expense }
  | { kind: 'category'; category: ExpenseCategory };

/**
 * Удаление записи или своей категории — через одно подтверждение. Занятая
 * категория сервер не удалит (409), его текст уходит в тост как есть.
 */
export function useExpenseRemoval() {
  const store = useExpensesStore();

  const open = ref(false);
  const target = ref<TTarget | null>(null);
  const busy = ref(false);

  function askExpense(expense: Expense): void {
    target.value = { kind: 'expense', expense };
    open.value = true;
  }

  function askCategory(category: ExpenseCategory): void {
    target.value = { kind: 'category', category };
    open.value = true;
  }

  async function confirm(): Promise<void> {
    const current = target.value;
    if (current === null) return;
    busy.value = true;
    try {
      if (current.kind === 'expense') {
        await store.remove(current.expense.id);
        toast.success('Удалено', `Расход «${current.expense.categoryLabel}»`);
      } else {
        await store.removeCategory(current.category.key);
        toast.success('Удалено', `Категория «${current.category.label}»`);
      }
    } catch (e) {
      toast.error('Не удалось удалить', e instanceof Error ? e.message : undefined);
    } finally {
      busy.value = false;
      open.value = false;
    }
  }

  return { open, target, busy, askExpense, askCategory, confirm };
}
