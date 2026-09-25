<script setup lang="ts">
/**
 * «FBY»: остатки на складе Маркета, проблемные позиции, заявки на вывоз и
 * поставки — тот же FbyService, что кнопка бота; xlsx — та же книга. Каждый
 * блок деградирует сам: сбой одного источника не прячет остальные.
 */
import { Download, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

import FbyProblemsCard from '../components/FbyProblemsCard.vue';
import FbyRequestsCard from '../components/FbyRequestsCard.vue';
import FbyStockCard from '../components/FbyStockCard.vue';
import FbySummary from '../components/FbySummary.vue';
import FbySuppliesCard from '../components/FbySuppliesCard.vue';
import { useFbyStore } from '../store/store.fby';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreKey } from '@/shared/composables';

const store = useFbyStore();
const storeKey = useStoreKey();
const { report, isLoading, isRefreshing, isFresh, savedAt, error } = storeToRefs(store);

// Срез — при открытии раздела (и при переходе в другой магазин).
watch(storeKey, (key) => void store.ensure(key), { immediate: true });
</script>

<template>
  <PageHeader title="FBY" :description="report?.heading">
    <template #actions>
      <Button variant="outline" :disabled="isLoading" @click="store.refresh(storeKey)">
        <RotateCw />
        Обновить
      </Button>
      <Button :disabled="!isFresh || !report?.file" @click="store.download()">
        <Download />
        Скачать xlsx
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
      Собираю сводку — Маркет готовит отчёт остатков, это до нескольких минут…
    </p>
    <Skeleton class="h-24 w-full" />
    <Skeleton class="h-64 w-full" />
    <Skeleton class="h-40 w-full" />
  </div>

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.refresh(storeKey)"
    />
    <div class="flex flex-col gap-6">
      <FbySummary :report="report" />
      <FbyStockCard :report="report" />
      <FbyProblemsCard v-if="report.stock" :problems="report.stock.problems" />
      <FbyRequestsCard :requests="report.requests" :problem="report.requestsProblem" />
      <FbySuppliesCard v-if="report.supplies.state !== 'off'" :supplies="report.supplies" />
    </div>
  </div>
</template>
