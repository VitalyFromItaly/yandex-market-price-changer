import type { FinanceMonth } from '../../finance.domain';
import type { DayRange } from '@/shared/utils';

import { computed, ref } from 'vue';

import { financeApi } from '../../api/financeApi.finance';

import { useBaseState } from '@/shared/composables';

/**
 * Месяцы выбора со статусом и выбранный месяц. Пока список не пришёл,
 * выбранного нет — экран не заказывает P&L за неизвестный месяц.
 */
export function useMonths() {
  const [months, setMonths, isLoading, resetMonths] = useBaseState<FinanceMonth[]>([]);
  const [selected, setSelected, , resetSelected] = useBaseState<string | null>(null);
  // Произвольный период из ссылки «Обзора»: перекрывает месяц у «Прибыли»,
  // ДДС и сверка берут месяц его начала. Выбор месяца его снимает.
  const [range, setRange, , resetRange] = useBaseState<DayRange | null>(null);
  const error = ref<string | null>(null);

  async function loadMonths(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const list = await financeApi.months();
      setMonths(list);
      // Выбранный остаётся, если он есть в списке; иначе — текущий (первый).
      if (!list.some((m) => m.month === selected.value)) setSelected(list[0]?.month ?? null);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить месяцы';
    } finally {
      isLoading.value = false;
    }
  }

  function selectMonth(month: string): void {
    setRange(null);
    setSelected(month);
  }

  /** Период из ссылки; месяц выбора — месяц его начала, если он в списке. */
  function selectRange(next: DayRange): void {
    setRange(next);
    setSelected(next.from.slice(0, 7));
  }

  const current = computed(() => months.value.find((m) => m.month === selected.value) ?? null);

  function reset(): void {
    resetMonths();
    resetSelected();
    resetRange();
    error.value = null;
  }

  return {
    months,
    selectedMonth: selected,
    selectedRange: range,
    currentMonth: current,
    monthsLoading: isLoading,
    monthsError: error,
    loadMonths,
    selectMonth,
    selectRange,
    reset,
  };
}
