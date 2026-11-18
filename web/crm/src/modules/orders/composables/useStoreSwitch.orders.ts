import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useStoresStore } from '@/modules/stores/store/store.stores';
import { useStoreKey } from '@/shared/composables';

/**
 * Фильтр «Магазин» реестра возвратов: в вебе магазин открывают, а не переключают, —
 * выбор ведёт на тот же раздел другого магазина (`:store` в адресе), активный магазин
 * бота не трогается. Список — кэш токена из нашей базы (без Partner API), поэтому
 * грузится при открытии экрана, если его ещё нет.
 */
export function useStoreSwitch() {
  const stores = useStoresStore();
  const route = useRoute();
  const router = useRouter();
  const current = useStoreKey();

  const options = computed(() =>
    (stores.stores ?? []).map((store) => ({ value: store.key, label: store.label })),
  );

  onMounted(() => {
    if (!(stores.stores ?? []).length && !stores.listLoading) void stores.loadList();
  });

  function choose(key: string | null): void {
    if (key === null || key === current.value) return;
    void router.push({ name: route.name ?? undefined, params: { ...route.params, store: key } });
  }

  return { options, current, choose };
}
