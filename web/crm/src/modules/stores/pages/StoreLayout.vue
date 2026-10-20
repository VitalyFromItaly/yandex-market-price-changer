<script setup lang="ts">
/**
 * Обёртка разделов магазина (`/ym/stores/:store/...`). Грузит вид магазина —
 * подпись и разделы по его модели — и держит отчёты разных магазинов
 * раздельно: открыли другой магазин — сторы отчётов чистятся, и чужие числа
 * не мелькнут под новым именем.
 */
import { ChevronLeft, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';
import { RouterLink, RouterView } from 'vue-router';

import { useStoresStore } from '../store/store.stores';
import { STORES_ROUTE_NAME } from '../stores.domain';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreKey } from '@/shared/composables';
import { resetAllStores } from '@/shared/store';

const store = useStoresStore();
const { current, currentError } = storeToRefs(store);
const key = useStoreKey();

watch(
  key,
  (next) => {
    if (next.length === 0) return;
    // Тот же магазин (вернулись из списка) — отчёты остаются, как были.
    if (current.value?.key !== next) resetAllStores();
    void store.open(next);
  },
  { immediate: true },
);

const ready = computed(() => current.value !== null && current.value.key === key.value);
</script>

<template>
  <div class="mb-4 flex min-w-0 items-center gap-2 text-sm">
    <Button variant="ghost" size="sm" class="-ml-2 shrink-0" as-child>
      <RouterLink :to="{ name: STORES_ROUTE_NAME }">
        <ChevronLeft />
        Все магазины
      </RouterLink>
    </Button>
    <span v-if="ready" class="truncate font-medium">{{ current?.label }}</span>
  </div>

  <div v-if="currentError" class="flex flex-col items-start gap-3">
    <Alert>{{ currentError }}</Alert>
    <Button variant="outline" @click="store.open(key)">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!ready" class="flex flex-col gap-4" aria-busy="true">
    <Skeleton class="h-8 w-48" />
    <Skeleton class="h-40 w-full" />
  </div>

  <RouterView v-else :key="key" />
</template>
