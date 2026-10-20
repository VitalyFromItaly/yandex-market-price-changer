import { ref } from 'vue';

import { useNotificationsStore } from '../store/store.notifications';

import { toast } from '@/components/ui/toast';

/** Действия ленты: «Проверить сейчас», «Прочитать все», «Прочитано» у строки. */
export function useFeedActions() {
  const store = useNotificationsStore();
  const busy = ref(false);

  async function run(action: () => Promise<void>, success: string, description?: string) {
    busy.value = true;
    try {
      await action();
      toast.success(success, description);
    } catch (e) {
      toast.error('Не получилось', e instanceof Error ? e.message : undefined);
    } finally {
      busy.value = false;
    }
  }

  const checkNow = () =>
    run(
      () => store.checkNow(),
      'Проверка запущена',
      'Остатки площадок собираются минуту-другую — обновите ленту чуть позже.',
    );
  const readAll = () => run(() => store.markRead('all'), 'Все прочитаны');
  const readOne = (id: string) => run(() => store.markRead([id]), 'Отмечено прочитанным');

  return { busy, checkNow, readAll, readOne };
}
