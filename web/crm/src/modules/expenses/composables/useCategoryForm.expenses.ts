import { ref } from 'vue';

import { useExpensesStore } from '../store/store.expenses';

import { toast } from '@/components/ui/toast';

/** Поле «новая категория»: ошибка проверки сервера — под полем, удача — поле пустеет. */
export function useCategoryForm() {
  const store = useExpensesStore();

  const name = ref('');
  const error = ref<string | null>(null);
  const busy = ref(false);

  async function add(): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
      await store.addCategory(name.value);
      toast.success('Сохранено', `Категория «${name.value.trim()}»`);
      name.value = '';
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось добавить категорию';
    } finally {
      busy.value = false;
    }
  }

  return { name, error, busy, add };
}
