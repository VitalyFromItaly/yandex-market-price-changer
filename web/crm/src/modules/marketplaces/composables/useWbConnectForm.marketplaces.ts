import { ref } from 'vue';

import { WB_FIELD_CODES } from '../marketplaces.domain';
import { useMarketplacesStore } from '../store/store.marketplaces';

import { toast } from '@/components/ui/toast';
import { ApiError } from '@/shared/http';

/**
 * Подключение токена WB: сервер проверяет его по нужным категориям и при
 * отказе не пишет ничего — прежний токен остаётся. Отказ по самому токену (в
 * том числе «нет категорий» с перечнем) — под поле; WB недоступен — тостом.
 */
export function useWbConnectForm(onDone: () => void = () => undefined) {
  const store = useMarketplacesStore();
  const token = ref('');
  const error = ref<string | null>(null);
  const busy = ref(false);

  async function submit(): Promise<void> {
    if (busy.value) return;
    error.value = null;
    busy.value = true;
    try {
      await store.connectWb(token.value.trim());
      token.value = '';
      toast.success('Wildberries подключён', 'Токен проверен в WB и сохранён.');
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code !== null && WB_FIELD_CODES.has(e.code)) {
        error.value = e.message;
      } else {
        toast.error('Токен не сохранён', e instanceof Error ? e.message : undefined);
      }
    } finally {
      busy.value = false;
    }
  }

  return { token, error, busy, submit };
}
