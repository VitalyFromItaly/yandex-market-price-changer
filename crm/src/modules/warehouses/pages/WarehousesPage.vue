<script setup lang="ts">
/**
 * «Склады»: склады Маркета с остатками и склады магазина — тот же
 * WarehousesService, что кнопка бота. Файла нет: бот его не шлёт.
 */
import { RotateCw, Warehouse } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

import WarehousesFbyCard from '../components/WarehousesFbyCard.vue';
import WarehousesStoreCard from '../components/WarehousesStoreCard.vue';
import { useWarehousesStore } from '../store/store.warehouses';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreKey } from '@/shared/composables';

const store = useWarehousesStore();
const storeKey = useStoreKey();
const { report, isLoading, isRefreshing, savedAt, error } = storeToRefs(store);

// Срез — при открытии раздела (и при переходе в другой магазин).
watch(storeKey, (key) => void store.ensure(key), { immediate: true });
</script>

<template>
  <PageHeader title="Склады" :description="report?.heading">
    <template #actions>
      <Button variant="outline" :disabled="isLoading" @click="store.refresh(storeKey)">
        <RotateCw />
        Обновить
      </Button>
    </template>
  </PageHeader>

  <div v-if="error && !report" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!report" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">
      Собираю склады — Маркет готовит отчёт остатков, это до нескольких минут…
    </p>
    <Skeleton class="h-64 w-full" />
    <Skeleton class="h-32 w-full" />
  </div>

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.refresh(storeKey)"
    />
    <EmptyState
      v-if="report.emptyText !== null"
      :icon="Warehouse"
      :title="report.emptyText"
      :description="report.heading"
    />

    <div v-else class="flex flex-col gap-6">
      <WarehousesFbyCard :report="report" />
      <WarehousesStoreCard :warehouses="report.store" :hint="report.storeHint" />
    </div>
  </div>
</template>
