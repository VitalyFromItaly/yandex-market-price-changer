import type { OzonCredentialsField } from '../marketplaces.domain';

import { ref } from 'vue';

import { OZON_FIELD_CODES } from '../marketplaces.domain';
import { useMarketplacesStore } from '../store/store.marketplaces';

import { toast } from '@/components/ui/toast';
import { ApiError } from '@/shared/http';

/**
 * Подключение ключа Ozon: сервер проверяет его у Ozon и при отказе не пишет
 * ничего — прежний ключ остаётся рабочим. Отказ по самому ключу встаёт под
 * поле, которое назвал сервер; недоступность Ozon — тостом: поля тут ни при чём.
 * `onDone` — форму на карточке «Подключений» можно свернуть.
 */
export function useOzonConnectForm(onDone: () => void = () => undefined) {
  const store = useMarketplacesStore();
  const clientId = ref('');
  const apiKey = ref('');
  const errors = ref<Record<OzonCredentialsField, string | null>>({ clientId: null, apiKey: null });
  const busy = ref(false);

  async function submit(): Promise<void> {
    if (busy.value) return;
    errors.value = { clientId: null, apiKey: null };
    busy.value = true;
    try {
      await store.connectOzon({ clientId: clientId.value.trim(), apiKey: apiKey.value.trim() });
      clientId.value = '';
      apiKey.value = '';
      toast.success('Ozon подключён', 'Ключ проверен в Ozon и сохранён.');
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code !== null && OZON_FIELD_CODES.has(e.code)) {
        const field: OzonCredentialsField = e.field === 'clientId' ? 'clientId' : 'apiKey';
        errors.value = { ...errors.value, [field]: e.message };
      } else {
        toast.error('Ключ не сохранён', e instanceof Error ? e.message : undefined);
      }
    } finally {
      busy.value = false;
    }
  }

  return { clientId, apiKey, errors, busy, submit };
}
