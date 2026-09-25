import { getCurrentScope, onScopeDispose, ref, watch } from 'vue';

/** Пауза после последнего нажатия: поиск по 4 тысячам строк на каждую букву не нужен. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Поле поиска с задержкой: `text` — то, что в поле, `onSearch` зовётся после
 * паузы. Таймер гасится при уходе со страницы.
 */
export function useDebouncedSearch(initial: string, onSearch: (q: string) => void) {
  const text = ref(initial);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stop(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  watch(text, (value) => {
    stop();
    timer = setTimeout(() => {
      timer = null;
      onSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  });

  if (getCurrentScope()) onScopeDispose(stop);

  return { text };
}
