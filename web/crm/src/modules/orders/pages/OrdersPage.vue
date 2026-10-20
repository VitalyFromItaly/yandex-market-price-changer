<script setup lang="ts">
/**
 * «Отчёты»: вкладки открытых отчётов, период, итоги и таблица, xlsx в шапке.
 * Отчёт собирается фоновой задачей — тем же сервисом, что кнопка бота, поэтому
 * числа сходятся с ботом до рубля.
 */
import type { ReportPeriod } from '@/shared/period';

import { Download, PackageX, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import OrdersByDayChart from '../components/OrdersByDayChart.vue';
import OrdersSummary from '../components/OrdersSummary.vue';
import OrdersTable from '../components/OrdersTable.vue';
import { useOrdersTabs } from '../composables/useOrdersTabs.orders';
import { ordersByDay, worthCharting } from '../mappers/ordersByDay.orders';
import { useOrdersStore } from '../store/store.orders';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStoreKey } from '@/shared/composables';
import { PeriodPicker, useLinkedPeriod } from '@/shared/period';

const store = useOrdersStore();
const storeKey = useStoreKey();
const { period, report, isRefreshing, isFresh, savedAt, error } = storeToRefs(store);
const { open, active, activeKey, deepHistory } = useOrdersTabs();

const unlimited = computed(() => deepHistory.value && active.value?.deepCapable === true);

/* День, выбранный на графике, — фильтр таблицы. Новый отчёт — фильтр снимается. */
const byDay = computed(() => (report.value === null ? null : ordersByDay(report.value.rows)));
const showChart = computed(() => byDay.value !== null && worthCharting(byDay.value));
const day = ref<string | null>(null);
const dayLabel = computed(() => byDay.value?.points.find((p) => p.key === day.value)?.date ?? null);
watch(report, () => {
  day.value = null;
});

function onPeriod(next: ReportPeriod): void {
  store.selectPeriod(next);
}

// Число с главной ведёт сюда с периодом в query — до первой загрузки.
useLinkedPeriod(onPeriod);

// Данные — при открытии, смене вкладки и периода. Прежняя задача при этом
// бросается (useJob.start), её поздний ответ не покажется.
watch(
  [() => active.value?.key, period],
  ([key]) => {
    if (key !== undefined) void store.load(key, storeKey.value);
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader title="Отчёты" :description="report?.heading ?? active?.label">
    <template #actions>
      <!-- Файл — по номеру задачи: у данных из кэша задачи нет, ждём свежие. -->
      <Button :disabled="!isFresh || report?.file == null" @click="store.download()">
        <Download />
        Скачать xlsx
      </Button>
    </template>
    <template v-if="open.length" #filters>
      <Tabs v-model="activeKey">
        <TabsList class="h-auto flex-wrap">
          <TabsTrigger v-for="meta in open" :key="meta.key" :value="meta.key">
            {{ meta.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <PeriodPicker
        v-if="active?.periodic"
        :model-value="period"
        :unlimited="unlimited"
        @update:model-value="onPeriod"
      />
    </template>
  </PageHeader>

  <EmptyState
    v-if="!open.length"
    title="Отчёты закрыты"
    description="Их открывает администратор бота. Напишите ему, если они вам нужны."
  />

  <div v-else-if="error && !report" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!report" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Собираю отчёт — у крупного магазина это до минуты…</p>
    <Skeleton class="h-32 w-full" />
    <Skeleton class="h-9 w-72" />
    <Skeleton class="h-64 w-full" />
  </div>

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.retry()"
    />
    <EmptyState
      v-if="report.count === 0"
      :icon="PackageX"
      :title="report.emptyText"
      :description="report.heading"
    />
    <div v-else class="flex flex-col gap-6">
      <OrdersSummary :report="report" />
      <OrdersByDayChart
        v-if="showChart && byDay"
        :points="byDay.points"
        :clipped="byDay.clipped"
        :selected="day"
        @select="day = $event"
      />
      <OrdersTable
        :rows="report.rows"
        :has-types="report.hasTypes"
        :day="day"
        :day-label="dayLabel"
        @clear-day="day = null"
      />
    </div>
  </div>
</template>
