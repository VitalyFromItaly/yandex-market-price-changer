import type {
  CorrectionRow,
  DiscrepancyRow,
  FinanceCorrection,
  FinanceDiscrepancy,
  FinancePage,
} from '../../finance.domain';

import { computed, ref } from 'vue';

import { financeApi } from '../../api/financeApi.finance';
import { AUDIT_PAGE_SIZE } from '../../finance.domain';
import { toCorrectionRow, toDiscrepancyRow } from '../../mappers/mapAudit.finance';

import { useBaseState } from '@/shared/composables';

type Loader<T> = (month: string, skip: number, limit: number) => Promise<FinancePage<T>>;

/** Одна постраничная выборка месяца: поздний ответ прежнего месяца или страницы отбрасывается. */
function usePagedList<T, R>(load: Loader<T>, map: (item: T, index: number) => R, failure: string) {
  const [page, setPage, isLoading, resetPage] = useBaseState<FinancePage<R> | null>(null);
  const index = ref(1);
  const error = ref<string | null>(null);
  let month: string | null = null;
  let generation = 0;

  async function fetch(nextMonth: string, nextIndex = 1): Promise<void> {
    const run = ++generation;
    month = nextMonth;
    index.value = nextIndex;
    isLoading.value = true;
    error.value = null;
    try {
      const skip = (nextIndex - 1) * AUDIT_PAGE_SIZE;
      const result = await load(nextMonth, skip, AUDIT_PAGE_SIZE);
      if (run === generation) {
        setPage({ total: result.total, items: result.items.map((item, i) => map(item, skip + i)) });
      }
    } catch (e) {
      if (run === generation) error.value = e instanceof Error ? e.message : failure;
    } finally {
      if (run === generation) isLoading.value = false;
    }
  }

  const pages = computed(() =>
    page.value === null ? 0 : Math.max(1, Math.ceil(page.value.total / AUDIT_PAGE_SIZE)),
  );

  function turn(next: number): Promise<void> {
    return month === null ? Promise.resolve() : fetch(month, next);
  }

  function reset(): void {
    generation += 1;
    month = null;
    resetPage();
    index.value = 1;
    error.value = null;
  }

  return { page, index, pages, isLoading, error, fetch, turn, reset };
}

/** Сверка месяца: расхождения с заказами и выплатами и корректировки Маркета. */
export function useAudit() {
  const discrepancies = usePagedList<FinanceDiscrepancy, DiscrepancyRow>(
    financeApi.discrepancies,
    toDiscrepancyRow,
    'Не удалось загрузить расхождения',
  );
  const corrections = usePagedList<FinanceCorrection, CorrectionRow>(
    financeApi.corrections,
    toCorrectionRow,
    'Не удалось загрузить корректировки',
  );

  async function loadAudit(month: string): Promise<void> {
    await Promise.all([discrepancies.fetch(month), corrections.fetch(month)]);
  }

  function reset(): void {
    discrepancies.reset();
    corrections.reset();
  }

  return {
    discrepancies: discrepancies.page,
    discrepanciesPage: discrepancies.index,
    discrepanciesPages: discrepancies.pages,
    discrepanciesLoading: discrepancies.isLoading,
    discrepanciesError: discrepancies.error,
    turnDiscrepancies: discrepancies.turn,
    corrections: corrections.page,
    correctionsPage: corrections.index,
    correctionsPages: corrections.pages,
    correctionsLoading: corrections.isLoading,
    correctionsError: corrections.error,
    turnCorrections: corrections.turn,
    loadAudit,
    reset,
  };
}
