import type { ProfitForm, SettingsErrors } from '../settings.domain';

import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import {
  isEmptyDiff,
  mapSettingsError,
  profitDiff,
  toProfitForm,
} from '../mappers/mapSettings.settings';
import { useSettingsStore } from '../store/store.settings';

import { toast } from '@/components/ui/toast';

/**
 * Форма ставок и скидок по брендам — одна кнопка «Сохранить» на обе карточки,
 * один запрос. На сервер уходят только изменённые поля (profitDiff).
 * После ответа форма пересобирается из сохранённого — видно то, что записано.
 */
export function useProfitForm() {
  const store = useSettingsStore();
  const { settings } = storeToRefs(store);

  const form = ref<ProfitForm | null>(null);
  const errors = ref<SettingsErrors>({});
  const busy = ref(false);

  watch(
    settings,
    (next) => {
      form.value = next === null ? null : toProfitForm(next);
    },
    { immediate: true },
  );

  const dirty = computed(
    () =>
      settings.value !== null &&
      form.value !== null &&
      !isEmptyDiff(profitDiff(settings.value, form.value)),
  );

  async function submit(): Promise<void> {
    if (settings.value === null || form.value === null) return;
    const body = profitDiff(settings.value, form.value);
    if (isEmptyDiff(body)) return;

    busy.value = true;
    errors.value = {};
    try {
      await store.saveProfit(body);
      toast.success('Сохранено', 'Прибыль пересчитается при следующем открытии отчёта.');
    } catch (e) {
      errors.value = mapSettingsError(e, 'Не удалось сохранить настройки');
    } finally {
      busy.value = false;
    }
  }

  /** Вернуть поля к сохранённому. */
  function discard(): void {
    if (settings.value !== null) form.value = toProfitForm(settings.value);
    errors.value = {};
  }

  return { form, errors, busy, dirty, submit, discard };
}
