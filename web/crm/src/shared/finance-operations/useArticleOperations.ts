import type { OpenedArticle, OperationRow } from './financeOperations.domain';

import { computed, ref } from 'vue';

import { OPERATIONS_PAGE_SIZE, ORIGINAL_FALLBACK_NAME } from './financeOperations.domain';
import { financeOperationsApi } from './financeOperationsApi';
import { toOperationRow } from './mapOperation';

import { useBaseState } from '@/shared/composables';
import { saveFile } from '@/shared/jobs';

/**
 * Статья (или ссылка ИИ-ответа), раскрытая до операций. У статьи id берутся
 * из ответа P&L — сумма раскрытия равна сумме статьи по построению; грузится страница id при открытии и при
 * листании, поздний ответ прежней страницы отбрасывается.
 */
export function useArticleOperations() {
  const [article, setArticle, , resetArticle] = useBaseState<OpenedArticle | null>(null);
  const [rows, setRows, isLoading, resetRows] = useBaseState<OperationRow[]>([]);
  const page = ref(1);
  const error = ref<string | null>(null);
  const downloadError = ref<string | null>(null);
  let generation = 0;

  const pages = computed(() =>
    article.value === null
      ? 0
      : Math.max(1, Math.ceil(article.value.operationIds.length / OPERATIONS_PAGE_SIZE)),
  );

  async function loadPage(next: number): Promise<void> {
    const opened = article.value;
    if (opened === null) return;
    const run = ++generation;
    page.value = next;
    isLoading.value = true;
    error.value = null;
    const start = (next - 1) * OPERATIONS_PAGE_SIZE;
    try {
      const items = await financeOperationsApi.operations(
        opened.operationIds.slice(start, start + OPERATIONS_PAGE_SIZE),
      );
      if (run === generation) setRows(items.map((op) => toOperationRow(op, opened.article)));
    } catch (e) {
      if (run === generation) {
        error.value = e instanceof Error ? e.message : 'Не удалось загрузить операции';
      }
    } finally {
      if (run === generation) isLoading.value = false;
    }
  }

  function openArticle(next: OpenedArticle): Promise<void> {
    setArticle(next);
    setRows([]);
    downloadError.value = null;
    return loadPage(1);
  }

  function closeArticle(): void {
    generation += 1;
    resetArticle();
    resetRows();
    page.value = 1;
    error.value = null;
    downloadError.value = null;
  }

  async function downloadOriginal(documentId: string): Promise<void> {
    downloadError.value = null;
    try {
      saveFile(await financeOperationsApi.original(documentId), ORIGINAL_FALLBACK_NAME);
    } catch (e) {
      downloadError.value = e instanceof Error ? e.message : 'Не удалось скачать оригинал';
    }
  }

  return {
    article,
    operations: rows,
    operationsPage: page,
    operationsPages: pages,
    operationsLoading: isLoading,
    operationsError: error,
    downloadError,
    openArticle,
    closeArticle,
    loadOperationsPage: loadPage,
    downloadOriginal,
    reset: closeArticle,
  };
}
