import type { CostMethod } from '../accounting.domain';

import { computed, ref } from 'vue';

import { useAccountingStore } from '../store/store.accounting';

import { toast } from '@/components/ui/toast';

/** Что сказать перед сменой режима: меняется только новый учёт, «Финансы» — нет. */
export const COST_METHOD_SWITCH_WARNING =
  'Меняется только новый учёт: «Финучёт» посчитает себестоимость заказов этим методом. ' +
  '«Финансы», «Прибыль» и налоги текущего расчёта останутся как были.';

/**
 * Переключатель режима себестоимости А/Б (TASK-216): выбор не пишется сразу —
 * сначала подтверждение с предупреждением, потом запись; ошибка — под
 * переключателем, режим остаётся прежним.
 */
export function useCostMethodSwitch() {
  const store = useAccountingStore();
  const pending = ref<CostMethod | null>(null);
  const busy = ref(false);
  const error = ref<string | null>(null);

  const current = computed<CostMethod | null>(() => store.costSettings?.method ?? null);
  const options = computed(() =>
    (store.costSettings?.options ?? []).map((option) => ({
      value: option.key,
      label: option.label,
    })),
  );
  const confirmTitle = computed(() => {
    const label = options.value.find((option) => option.value === pending.value)?.label;
    return label ? `Перейти на «${label}»?` : 'Сменить режим себестоимости?';
  });
  const open = computed({
    get: () => pending.value !== null,
    set: (value: boolean) => {
      if (!value && !busy.value) pending.value = null;
    },
  });

  function choose(method: CostMethod): void {
    if (method === current.value) return;
    error.value = null;
    pending.value = method;
  }

  async function confirm(): Promise<void> {
    const method = pending.value;
    if (method === null) return;
    busy.value = true;
    try {
      await store.saveCostSettings(method);
      toast.success('Режим себестоимости изменён');
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось сменить режим';
    } finally {
      busy.value = false;
      pending.value = null;
    }
  }

  return { current, options, open, busy, error, confirmTitle, choose, confirm };
}
