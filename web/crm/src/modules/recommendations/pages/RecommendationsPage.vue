<script setup lang="ts">
/**
 * «Рекомендации цен»: срез Маркета по товарам с непривлекательной ценой —
 * итоги, таблица с фильтрами, xlsx в шапке. Собирается фоновой задачей тем же
 * RecommendationsService, что кнопка бота.
 */
import { Download, RotateCw, Target } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

import RecommendationsSummary from '../components/RecommendationsSummary.vue';
import RecommendationsTable from '../components/RecommendationsTable.vue';
import { useRecommendationsStore } from '../store/store.recommendations';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreKey } from '@/shared/composables';
import { formatCount } from '@/shared/utils';

const store = useRecommendationsStore();
const storeKey = useStoreKey();
const { report, isLoading, isRefreshing, isFresh, savedAt, error } = storeToRefs(store);

// Срез — при открытии раздела (и при переходе в другой магазин).
watch(storeKey, (key) => void store.ensure(key), { immediate: true });
</script>

<template>
  <PageHeader title="Рекомендации цен" :description="report?.heading">
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
    <p class="text-sm text-muted-foreground">Собираю рекомендации Маркета — это десятки секунд…</p>
    <Skeleton class="h-24 w-full" />
    <Skeleton class="h-9 w-72" />
    <Skeleton class="h-64 w-full" />
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
      :icon="Target"
      :title="report.emptyText"
      :description="report.heading"
    />

    <div v-else class="flex flex-col gap-6">
      <RecommendationsSummary :report="report" />
      <RecommendationsTable :rows="report.rows" />
      <p v-if="report.file?.truncated" class="tnum text-sm text-muted-foreground">
        В файл вошли первые {{ formatCount(report.file.rows) }} строк — полный список в таблице.
      </p>
    </div>
  </div>
</template>
