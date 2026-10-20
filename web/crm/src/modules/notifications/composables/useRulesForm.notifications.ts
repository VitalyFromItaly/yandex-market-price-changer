import type { RulesForm, SettingsErrors } from '../notifications.domain';

import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import {
  mapSettingsError,
  rulesDiff,
  toRulesForm,
} from '../mappers/mapNotifications.notifications';
import { useNotificationsStore } from '../store/store.notifications';

import { toast } from '@/components/ui/toast';

/**
 * Форма правил — одна кнопка «Сохранить», один запрос; на сервер уходят только
 * изменённые правила (rulesDiff). После ответа форма пересобирается из
 * сохранённого — видно то, что записано.
 */
export function useRulesForm() {
  const store = useNotificationsStore();
  const { settings } = storeToRefs(store);

  const form = ref<RulesForm | null>(null);
  const errors = ref<SettingsErrors>({});
  const busy = ref(false);

  watch(
    settings,
    (next) => {
      form.value = next === null ? null : toRulesForm(next);
    },
    { immediate: true },
  );

  const dirty = computed(
    () =>
      settings.value !== null &&
      form.value !== null &&
      rulesDiff(settings.value, form.value).rules !== undefined,
  );

  async function submit(): Promise<void> {
    if (settings.value === null || form.value === null) return;
    const body = rulesDiff(settings.value, form.value);
    if (body.rules === undefined) return;
    busy.value = true;
    errors.value = {};
    try {
      await store.saveSettings(body);
      toast.success('Сохранено', 'Правила применятся при следующей проверке.');
    } catch (e) {
      errors.value = mapSettingsError(e, 'Не удалось сохранить правила');
    } finally {
      busy.value = false;
    }
  }

  function discard(): void {
    if (settings.value !== null) form.value = toRulesForm(settings.value);
    errors.value = {};
  }

  return { form, errors, busy, dirty, submit, discard };
}
