import type { SettingsErrors } from '../notifications.domain';

import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import { mapSettingsError } from '../mappers/mapNotifications.notifications';
import { useNotificationsStore } from '../store/store.notifications';

import { toast } from '@/components/ui/toast';

/**
 * Блок «Telegram»: тумблер сохраняется сразу (writable computed), время — по
 * кнопке, тем же разбором, что «⏰ Рассылка» бота (проверяет сервер).
 */
export function useTelegramForm() {
  const store = useNotificationsStore();
  const { settings } = storeToRefs(store);
  const time = ref('');
  const errors = ref<SettingsErrors>({});
  const busy = ref(false);

  watch(
    settings,
    (next) => {
      time.value = next?.time ?? '';
    },
    { immediate: true },
  );

  async function save(body: { telegram?: boolean; time?: string }, success: string) {
    busy.value = true;
    errors.value = {};
    try {
      await store.saveSettings(body);
      toast.success(success);
    } catch (e) {
      errors.value = mapSettingsError(e, 'Не удалось сохранить');
    } finally {
      busy.value = false;
    }
  }

  const enabled = computed<boolean>({
    get: () => settings.value?.telegram === true,
    set: (value) => {
      void save({ telegram: value }, value ? 'Уведомления в Telegram включены' : 'Выключено');
    },
  });

  const timeDirty = computed(
    () => settings.value !== null && time.value.trim() !== settings.value.time,
  );

  async function saveTime(): Promise<void> {
    if (!timeDirty.value) return;
    await save({ time: time.value.trim() }, 'Время сохранено');
  }

  return { enabled, time, errors, busy, timeDirty, saveTime };
}
