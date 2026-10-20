import type { TaxBody, TaxesView } from '../../taxes.domain';

import { ref } from 'vue';

import { taxesApi } from '../../api/taxesApi.taxes';

import { useBaseState } from '@/shared/composables';

/**
 * Налоговые настройки: загрузка и запись. Запись заменяет вид ответом
 * сервера; её ошибка пробрасывается — под какое поле ставить, решает форма.
 */
export function useTaxSettings() {
  const [view, setView, isLoading, resetView, hasView] = useBaseState<TaxesView | null>(null);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      setView(await taxesApi.get());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить налоговые настройки';
    } finally {
      isLoading.value = false;
    }
  }

  async function save(body: TaxBody): Promise<void> {
    setView(await taxesApi.save(body));
  }

  function reset(): void {
    resetView();
    error.value = null;
  }

  return { view, isLoading, hasView, error, load, save, reset };
}
