import { defineStore } from 'pinia';

import { useProductCard } from './composables/useProductCard.products';
import { useProductList } from './composables/useProductList.products';
import { useUnmatched } from './composables/useUnmatched.products';

/** Стор раздела «Товары» — фасад трёх слайсов: список, карточка, очередь. */
export const useProductsStore = defineStore('products', () => {
  const list = useProductList();
  const card = useProductCard();
  const unmatched = useUnmatched();

  return {
    // Имена слайсов пересекаются (page, load, reset) — наружу под префиксами.
    listPage: list.page,
    listQuery: list.query,
    listLoading: list.isLoading,
    listError: list.error,
    loadList: list.load,
    search: list.search,
    filterBrand: list.filterBrand,
    goToListPage: list.goTo,
    findProducts: list.find,

    card: card.card,
    cardLoading: card.isLoading,
    cardError: card.error,
    loadCard: card.load,
    savePurchase: card.savePurchase,
    linkCard: card.link,
    unlinkCard: card.unlink,

    unmatchedPage: unmatched.page,
    unmatchedLoading: unmatched.isLoading,
    unmatchedError: unmatched.error,
    loadUnmatched: unmatched.load,
    linkUnmatched: unmatched.link,

    // Общий reset — последним.
    reset() {
      list.reset();
      card.reset();
      unmatched.reset();
    },
  };
});
