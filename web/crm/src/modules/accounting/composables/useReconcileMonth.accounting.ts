import { computed, ref } from 'vue';

import { monthLabel, moscowTodayIso, recentMonths } from '@/shared/period';

export interface ReconcileMonthOption {
  value: string;
  label: string;
}

/**
 * Месяц сверки (TASK-228): только закрытые — документы Маркета за текущий ещё
 * не готовы. По умолчанию — прошлый месяц; 12 месяцев назад, как «Финансы».
 */
export function useReconcileMonth(today: string = moscowTodayIso()) {
  const options = computed<ReconcileMonthOption[]>(() =>
    recentMonths(today, 13)
      .slice(1)
      .map((value) => ({ value, label: monthLabel(value) })),
  );
  const month = ref<string>(options.value[0]?.value ?? today.slice(0, 7));
  const label = computed(
    () => options.value.find((o) => o.value === month.value)?.label ?? month.value,
  );
  return { month, options, label };
}
