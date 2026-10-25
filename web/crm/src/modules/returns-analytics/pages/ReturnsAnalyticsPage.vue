<script setup lang="ts">
/**
 * «Аналитика возвратов» (TASK-145, ТЗ п.11): штуки и заказы возвратов, % от
 * выкупов, сумма, обратная логистика, удержания, невозвращённые комиссии и
 * потери — по брендам и товарам. Числа — из финансового журнала площадки
 * экрана (из адреса, TASK-182): у каждой площадки свой экран.
 */
import type { ReturnsKpi } from '../returns-analytics.domain';
import type { Component } from 'vue';

import { Coins, Percent, RotateCw, Truck, Undo2, Wallet } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import ReturnsBreakdownTable from '../components/ReturnsBreakdownTable.vue';
import {
  brandRows,
  isQuiet,
  kpisOf,
  restRow,
  skuRow,
  totalRow,
} from '../mappers/mapReturnsAnalytics.returns-analytics';
import {
  FINANCE_FEATURE,
  LOSSES_HINT,
  RATE_HINT,
  REST_NOTE,
  RETURNS_SLICE_OPTIONS,
} from '../returns-analytics.domain';
import { useReturnsAnalyticsStore } from '../store/store.returns-analytics';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useMarketplace } from '@/shared/composables';
import { JournalPull, useFinanceJournal } from '@/shared/finance-journal';
import { RangePicker, rangeLabel } from '@/shared/period';

const ICON: Record<ReturnsKpi['key'], Component> = {
  units: Undo2,
  rate: Percent,
  amount: Wallet,
  logistics: Truck,
  losses: Coins,
};

const store = useReturnsAnalyticsStore();
const auth = useAuthStore();
const routeMarketplace = useMarketplace();
const marketplace = computed(() => routeMarketplace.value ?? 'ym');
store.selectMarketplace(marketplace.value);

// Журнал периода не загружен — баннер с «Загрузить из Маркета», а не пустой экран.
const journal = useFinanceJournal(
  () => (store.range ? { marketplace: marketplace.value, ...store.range } : null),
  () => store.load(),
);
const { data, isRefreshing, savedAt, error, slice, query, current, visibleSkus } =
  storeToRefs(store);

const ready = computed(() => auth.me !== null);
const withFinance = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);

const periodLabel = computed(() => (store.range ? rangeLabel(store.range) : ''));
const kpis = computed(() => (current.value ? kpisOf(current.value) : []));
const total = computed(() => (current.value ? totalRow(current.value) : null));
const rest = computed(() => (current.value ? restRow(current.value) : null));
const skuRows = computed(() => visibleSkus.value.map(skuRow));
const quiet = computed(() => (current.value ? isQuiet(current.value) : false));

watch(
  () =>
    ready.value && withFinance.value && store.range
      ? `${marketplace.value}:${store.range.from}:${store.range.to}`
      : null,
  (key) => {
    store.selectMarketplace(marketplace.value);
    if (key !== null) store.load();
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader
    title="Аналитика возвратов"
    description="Возвраты, процент от выкупов и потери на них — по брендам и товарам"
  >
    <template #filters>
      <RangePicker
        :preset="store.preset"
        :custom="store.custom"
        @preset="store.choosePreset($event)"
        @custom="store.chooseCustom($event)"
      />
    </template>
  </PageHeader>

  <Alert v-if="ready && !withFinance">
    Возвраты считаются по финансовому журналу — откройте «Финансы» у администратора.
  </Alert>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Собираю возвраты из журнала…</p>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Skeleton v-for="i in 5" :key="i" class="h-24" />
    </div>
    <Skeleton class="h-64 w-full" />
  </div>

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.retry()"
    />

    <Alert v-for="p in data.problems" :key="p.marketplace">{{ p.problem }}</Alert>

    <p class="tnum text-sm text-muted-foreground">
      {{ periodLabel }}<template v-if="current"> · {{ current.label }}</template>
    </p>

    <JournalPull :journal="journal" />

    <EmptyState
      v-if="!current || quiet"
      :icon="Undo2"
      title="За период возвратов нет"
      description="В журнале площадки за эти даты нет возвратов и их расходов — или месяц ещё не загружен."
    />

    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          v-for="kpi in kpis"
          :key="kpi.key"
          :label="kpi.label"
          :icon="ICON[kpi.key]"
          :value="kpi.value"
          :caption="kpi.caption"
        />
      </div>

      <OptionGroup
        :model-value="slice"
        :options="RETURNS_SLICE_OPTIONS"
        label="Разрез"
        @update:model-value="store.setSlice($event)"
      />

      <ReturnsBreakdownTable
        v-if="slice === 'brand'"
        :rows="brandRows(current)"
        title="Бренд"
        :rest="rest"
        :total="total"
      />

      <template v-else>
        <Input
          :model-value="query"
          class="h-9 w-72"
          placeholder="Название или артикул"
          aria-label="Поиск товара"
          @update:model-value="store.setQuery(String($event))"
        />
        <ReturnsBreakdownTable
          v-if="skuRows.length"
          :rows="skuRows"
          title="Товар"
          :rest="query ? null : rest"
          :total="total"
        />
        <p v-else class="text-sm text-muted-foreground">Ничего не найдено.</p>
        <p v-if="query" class="text-xs text-muted-foreground">
          Итого — за весь период, без учёта поиска.
        </p>
      </template>
    </template>

    <p class="text-xs text-muted-foreground">
      {{ LOSSES_HINT }} {{ RATE_HINT }}
      <template v-if="rest">{{ REST_NOTE }}</template>
      Возвраты в пути — в отчёте «Едет обратно».
    </p>
    <p v-for="note in data.notes" :key="note" class="text-xs text-muted-foreground">{{ note }}</p>
  </div>
</template>
