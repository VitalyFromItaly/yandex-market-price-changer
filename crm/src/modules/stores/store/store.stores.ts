import { defineStore } from 'pinia';

import { useStoreContext } from './composables/useStoreContext.stores';
import { useStoresList } from './composables/useStoresList.stores';

/** Стор раздела «Магазины» — тонкий фасад: список магазинов и открытый магазин. */
export const useStoresStore = defineStore('stores', () => {
  const list = useStoresList();
  const context = useStoreContext();
  return {
    stores: list.stores,
    listLoading: list.isLoading,
    listRefreshing: list.isRefreshing,
    listSavedAt: list.savedAt,
    listError: list.error,
    loadList: list.load,
    replaceToken: list.replaceToken,
    current: context.current,
    currentLoading: context.isLoading,
    currentError: context.error,
    open: context.open,
    reset() {
      list.reset();
      context.reset();
    },
  };
});
