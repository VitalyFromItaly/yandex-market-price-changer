<script setup lang="ts">
/**
 * «Магазины» — стартовая CRM: магазины токена и смена токена. Магазин здесь не
 * переключают, а открывают: отчёты внутри считаются по нему, активный магазин
 * бота остаётся прежним.
 */
import { RotateCw, Store } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';

import StoresTable from '../components/StoresTable.vue';
import TokenCard from '../components/TokenCard.vue';
import { useSingleStoreEntry } from '../composables/useSingleStoreEntry.stores';
import { useStoresStore } from '../store/store.stores';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';

const store = useStoresStore();
const { stores, listError, listRefreshing, listSavedAt } = storeToRefs(store);

useSingleStoreEntry(stores);

onMounted(() => {
  void store.loadList();
});
</script>

<template>
  <PageHeader
    title="Магазины"
    description="Откройте магазин — отчёты, прибыль и прайс считаются по нему"
  />

  <div class="flex max-w-4xl flex-col gap-6">
    <div v-if="listError && !stores" class="flex flex-col items-start gap-3">
      <Alert>{{ listError }}</Alert>
      <Button variant="outline" @click="store.loadList()">
        <RotateCw />
        Повторить
      </Button>
    </div>

    <Skeleton v-else-if="!stores" class="h-40 w-full" />

    <RefreshIndicator
      v-if="stores"
      :refreshing="listRefreshing"
      :saved-at="listSavedAt"
      :error="listError"
      @retry="store.loadList()"
    />

    <EmptyState
      v-if="stores && !stores.length"
      :icon="Store"
      title="Маркет не вернул ни одного магазина"
      description="Проверьте, что токен выдан на нужный кабинет, или пришлите новый ниже."
    />

    <StoresTable v-else-if="stores" :stores="stores" />

    <TokenCard />
  </div>
</template>
