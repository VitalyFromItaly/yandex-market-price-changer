import type { ProductListItem, UnmatchedCard, UnmatchedCandidate } from '../products.domain';

import { computed, ref } from 'vue';

import { useProductsStore } from '../store/store.products';

import { toast } from '@/components/ui/toast';
import { useDebouncedSearch } from '@/shared/composables';

/** Сколько найденных товаров показывать: выбор, а не список. */
const SEARCH_LIMIT = 10;

/**
 * Ручная привязка карточки из очереди: кандидаты, которых нашёл сервер, плюс
 * поиск по всем товарам — пары может не быть среди кандидатов вовсе (`no_match`).
 * Правила привязки — на сервере, тот же сервис, что у админки.
 */
export function useLinkDialog() {
  const store = useProductsStore();

  const open = ref(false);
  const target = ref<UnmatchedCard | null>(null);
  const selected = ref<string | null>(null);
  const found = ref<ProductListItem[]>([]);
  const searching = ref(false);
  const error = ref<string | null>(null);
  const busy = ref(false);
  let generation = 0;

  const candidates = computed<UnmatchedCandidate[]>(() => target.value?.candidates ?? []);

  async function runSearch(q: string): Promise<void> {
    const run = ++generation;
    if (q.trim().length === 0) {
      found.value = [];
      return;
    }
    searching.value = true;
    try {
      const page = await store.findProducts(q, SEARCH_LIMIT);
      if (run === generation) found.value = page.items;
    } catch (e) {
      if (run === generation) error.value = e instanceof Error ? e.message : 'Поиск не удался';
    } finally {
      if (run === generation) searching.value = false;
    }
  }

  const { text: query } = useDebouncedSearch('', (q) => void runSearch(q));

  function show(card: UnmatchedCard): void {
    target.value = card;
    selected.value = card.candidates.length === 1 ? (card.candidates[0]?.productId ?? null) : null;
    query.value = '';
    found.value = [];
    error.value = null;
    open.value = true;
  }

  async function confirm(): Promise<void> {
    const card = target.value;
    if (card === null || selected.value === null) return;
    busy.value = true;
    error.value = null;
    try {
      await store.linkUnmatched(selected.value, { marketplace: card.marketplace, sku: card.sku });
      open.value = false;
      toast.success('Привязано', `Карточка ${card.sku} привязана к товару`);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось привязать карточку';
    } finally {
      busy.value = false;
    }
  }

  return {
    open,
    target,
    candidates,
    selected,
    query,
    found,
    searching,
    error,
    busy,
    show,
    confirm,
  };
}
