<script setup lang="ts">
/**
 * «Аналитика продаж» (TASK-140, ТЗ п.9): выручка, заказы, штуки, средний чек
 * и скорость продаж за период — по времени, брендам, товарам и площадкам.
 * Числа — разрезы того же P&L, что «Финансы»: выручка любого разреза в сумме
 * равна выручке «Финансов» за тот же период (ссылка ведёт туда с этим периодом).
 */
import type { SalesKpi } from '../sales-analytics.domain';
import type { Component } from 'vue';

import { ClipboardList, Gauge, Package, Receipt, RotateCw, ShoppingCart } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import SalesBreakdownTable from '../components/SalesBreakdownTable.vue';
import SalesTimeChart from '../components/SalesTimeChart.vue';
import {
  brandRows,
  bucketsOf,
  kpisOf,
  marketplaceRows,
  skuRow,
  toSalesRow,
} from '../mappers/mapSalesAnalytics.sales-analytics';
import {
  FINANCE_FEATURE,
  ORDERS_NOTE,
  REST_NOTE,
  SALES_METRIC_OPTIONS,
  SALES_SLICE_OPTIONS,
  SKU_SORT_OPTIONS,
  TIME_GRAIN_OPTIONS,
  VELOCITY_HINT,
} from '../sales-analytics.domain';
import { useSalesAnalyticsStore } from '../store/store.sales-analytics';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { UPCOMING_MARKETPLACES } from '@/navigation';
import { RangePicker, rangeLabel, rangeQuery } from '@/shared/period';
import { formatCount, formatKopecks } from '@/shared/utils';

const ICON: Record<SalesKpi['key'], Component> = {
  revenue: ShoppingCart,
  orders: ClipboardList,
  units: Package,
  avgCheck: Receipt,
  velocity: Gauge,
};

const store = useSalesAnalyticsStore();
const auth = useAuthStore();
const { data, isRefreshing, savedAt, error, slice, grain, metric, query, sort, visibleSkus } =
  storeToRefs(store);

const ready = computed(() => auth.me !== null);
const withFinance = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);

const periodLabel = computed(() => (store.range ? rangeLabel(store.range) : ''));
const kpis = computed(() => (data.value ? kpisOf(data.value) : []));
const buckets = computed(() => (data.value ? bucketsOf(data.value, grain.value) : []));
const total = computed(() =>
  data.value
    ? toSalesRow('total', 'Итого', null, data.value.totals, {
        revenueKopecks: data.value.previousTotals.revenueKopecks,
        units: data.value.previousTotals.units,
      })
    : null,
);
const rest = computed(() =>
  data.value && (data.value.rest.revenueKopecks !== 0 || data.value.rest.units !== 0)
    ? {
        revenue: formatKopecks(data.value.rest.revenueKopecks),
        units: formatCount(data.value.rest.units),
      }
    : null,
);
const skuRows = computed(() => visibleSkus.value.map(skuRow));
const upcoming = UPCOMING_MARKETPLACES.map((m) => ({ key: m.key, label: m.label }));
const isEmpty = computed(
  () => data.value !== null && data.value.days.length === 0 && data.value.skus.length === 0,
);
const financeLink = computed(() =>
  store.range
    ? { name: 'ym-finance', params: { tab: 'pnl' }, query: rangeQuery(store.range) }
    : null,
);

const statusTone = computed(() => {
  const status = data.value?.status;
  if (status === 'verified') return 'ok';
  return status === 'discrepancy' ? 'danger' : 'warn';
});

watch(
  () =>
    ready.value && withFinance.value && store.request
      ? `${store.request.range.from}:${store.request.range.to}`
      : null,
  (key) => {
    if (key !== null) store.load();
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader
    title="Аналитика продаж"
    description="Выручка, заказы, штуки и скорость продаж по времени, брендам, товарам и площадкам"
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
    Продажи считаются по финансовому журналу — откройте «Финансы» у администратора.
  </Alert>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Собираю продажи из журнала…</p>
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

    <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span class="tnum">{{ periodLabel }}</span>
      <Badge :variant="statusTone">{{ data.statusLabel }}</Badge>
      <span>
        выручка как в
        <RouterLink v-if="financeLink" :to="financeLink" class="text-foreground underline">
          «Финансах»
        </RouterLink>
        · к периоду {{ rangeLabel(data.previousPeriod) }}
      </span>
    </div>

    <EmptyState
      v-if="isEmpty"
      :icon="ShoppingCart"
      title="За период продаж нет"
      description="Журнал Маркета за эти даты пуст или ещё не загружен."
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
        :options="SALES_SLICE_OPTIONS"
        label="Разрез"
        @update:model-value="store.setSlice($event)"
      />

      <template v-if="slice === 'time'">
        <div class="flex flex-wrap items-center gap-3">
          <OptionGroup
            :model-value="grain"
            :options="TIME_GRAIN_OPTIONS"
            label="Шаг"
            @update:model-value="store.setGrain($event)"
          />
          <OptionGroup
            :model-value="metric"
            :options="SALES_METRIC_OPTIONS"
            label="Показатель графика"
            @update:model-value="store.setMetric($event)"
          />
        </div>
        <SalesTimeChart :buckets="buckets" :metric="metric" />
      </template>

      <template v-else-if="slice === 'brand' && total">
        <SalesBreakdownTable :rows="brandRows(data)" title="Бренд" :total="total" :rest="rest" />
        <p class="text-xs text-muted-foreground">{{ ORDERS_NOTE }}</p>
      </template>

      <template v-else-if="slice === 'sku' && total">
        <div class="flex flex-wrap items-center gap-3">
          <Input
            :model-value="query"
            class="h-9 w-72"
            placeholder="Название или артикул"
            aria-label="Поиск товара"
            @update:model-value="store.setQuery(String($event))"
          />
          <OptionGroup
            :model-value="sort"
            :options="SKU_SORT_OPTIONS"
            label="Сортировка"
            @update:model-value="store.setSort($event)"
          />
        </div>
        <SalesBreakdownTable
          v-if="skuRows.length"
          :rows="skuRows"
          title="Товар"
          :total="total"
          :rest="query ? null : rest"
        />
        <p v-else class="text-sm text-muted-foreground">Ничего не найдено.</p>
        <p class="text-xs text-muted-foreground">
          {{ ORDERS_NOTE }}
          <template v-if="query">Итого — за весь период, без учёта поиска.</template>
        </p>
      </template>

      <template v-else-if="slice === 'marketplace' && total">
        <SalesBreakdownTable
          :rows="marketplaceRows(data)"
          title="Площадка"
          :total="total"
          :upcoming="upcoming"
        />
        <p class="text-xs text-muted-foreground">
          Финансовый журнал пока только у Маркета — Ozon и Wildberries появятся, когда будут
          подключены их отчёты.
        </p>
      </template>

      <p class="text-xs text-muted-foreground">
        {{ VELOCITY_HINT }}
        <template v-if="rest && (slice === 'brand' || slice === 'sku')">{{ REST_NOTE }}</template>
        <template v-if="data.status !== 'verified'">
          Числа могут измениться, пока Маркет не закрыл период.
        </template>
      </p>
    </template>
  </div>
</template>
