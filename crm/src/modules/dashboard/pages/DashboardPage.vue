<script setup lang="ts">
/**
 * «Главная»: площадки, общий период и ряд KPI — деньги периода из «Прибыли»
 * (продажи → комиссия → налог → закуп → чистая), затем срезы «сейчас»: что едет
 * к покупателю и обратно, что лежит на складе Маркета. Каждый источник — своя
 * фоновая задача (та же, что у страницы отчёта), грузится и падает сам.
 */
import type {
  DashboardPeriodKey,
  KpiKey,
  KpiMeta,
  OrderRowKey,
  OrderRowView,
} from '../dashboard.domain';
import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

import {
  Boxes,
  ClipboardList,
  Landmark,
  Package,
  PackageCheck,
  Percent,
  ShoppingCart,
  TrendingUp,
  Truck,
  Undo2,
  XCircle,
} from 'lucide-vue-next';
import { computed, watch } from 'vue';

import LowStockCard from '../components/LowStockCard.vue';
import MarketplaceTabs from '../components/MarketplaceTabs.vue';
import OrdersStatusCard from '../components/OrdersStatusCard.vue';
import PriceListTile from '../components/PriceListTile.vue';
import ProfitChartCard from '../components/ProfitChartCard.vue';
import QuickLinks from '../components/QuickLinks.vue';
import TopProductsCard from '../components/TopProductsCard.vue';
import UnitEconomicsCard from '../components/UnitEconomicsCard.vue';
import { useDashboardKpis } from '../composables/useDashboardKpis.dashboard';
import {
  DASHBOARD_PERIOD_OPTIONS,
  ICON_TONE_CLASS,
  SHINY_CARD,
  PROFIT_CHART,
  SOURCE,
  SOURCES,
  isDashboardPeriod,
  profitChartVisible,
  sourcePeriod,
} from '../dashboard.domain';
import { mapLowStock, mapTopSkus } from '../mappers/mapProducts.dashboard';
import { useDashboardStore } from '../store/store.dashboard';

import { KpiCard } from '@/components/ui/kpi-card';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { useStoreKey } from '@/shared/composables';
import { periodQuery } from '@/shared/period';

const ICON: Record<KpiKey, Component> = {
  sales: ShoppingCart,
  commission: Percent,
  tax: Landmark,
  purchase: Package,
  net: TrendingUp,
  in_transit: Truck,
  returning: Undo2,
  stock: Boxes,
};

const ROW_ICON: Record<OrderRowKey, Component> = {
  placed: ClipboardList,
  in_transit: Truck,
  redeemed: PackageCheck,
  returning: Undo2,
  cancelled: XCircle,
};

const store = useDashboardStore();
const storeKey = useStoreKey();
const { ready, sources, kpis, orderRows, links, priceListOpen, fbyOpen, ordersOpen } =
  useDashboardKpis();

type Linked = Pick<KpiMeta, 'source' | 'route' | 'report'>;

const metaOf = (item: Linked) => SOURCES.find((meta) => meta.key === item.source);

/** Отчёт, откуда число, с периодом его источника — окна обязаны совпадать. */
function targetOf(item: Linked): RouteLocationRaw {
  const meta = metaOf(item);
  const period = meta ? sourcePeriod(meta, store.period) : null;
  return {
    name: item.route,
    params: item.report === null ? {} : { report: item.report },
    query: period === null ? {} : periodQuery(period),
  };
}

const rowViews = computed<OrderRowView[]>(() =>
  orderRows.value.map((row) => {
    const source = store.sources[row.source];
    return {
      key: row.key,
      label: row.label,
      icon: ROW_ICON[row.key],
      iconTone: row.iconTone,
      to: targetOf(row),
      summary: source.rows?.[row.key] ?? null,
      isRefreshing: source.isRefreshing,
      error: source.error,
      loadingText: metaOf(row)?.loadingText ?? '',
    };
  }),
);

const profitSource = computed(() => store.sources[PROFIT_CHART.source]);
/** График — когда «Прибыль» открыта продавцу и период длиннее дня. */
const showChart = computed(
  () => sources.value.includes(PROFIT_CHART.source) && profitChartVisible(store.period),
);
const chartHeading = computed(() => profitSource.value.summaries?.sales?.heading ?? null);

// «Топ товаров» и «На исходе»: товары — из «Прибыли», остаток — своим срезом.
const stocksSource = computed(() => store.sources[SOURCE.STOCKS]);
const showProducts = computed(() => sources.value.includes(SOURCE.PROFIT));
const levels = computed(() => stocksSource.value.levels);
const stocksLoadingText = SOURCES.find((meta) => meta.key === SOURCE.STOCKS)?.loadingText ?? '';
const topRows = computed(() => {
  const skus = profitSource.value.skus;
  return skus === null ? null : mapTopSkus(skus, levels.value);
});
const lowRows = computed(() => {
  const skus = profitSource.value.skus;
  return skus === null || levels.value === null ? null : mapLowStock(skus, levels.value);
});
/** Куда пополнять: на FBY — «FBY», иначе «Прайс»; закрытый раздел — без ссылки. */
const lowStockLink = computed(() => {
  if (levels.value?.fby && fbyOpen.value) return { to: { name: 'ym-fby' }, label: 'Остатки FBY' };
  if (priceListOpen.value) return { to: { name: 'ym-price-list' }, label: 'Загрузить прайс' };
  return null;
});
const productsError = computed(() => profitSource.value.error ?? stocksSource.value.error);

function retryProducts(): void {
  if (profitSource.value.error) void profitSource.value.retry();
  if (stocksSource.value.error) void stocksSource.value.retry();
}

function retryRow(key: OrderRowKey): void {
  const row = orderRows.value.find((item) => item.key === key);
  if (row) void store.sources[row.source].retry();
}

function choosePeriod(next: DashboardPeriodKey | string | number): void {
  if (isDashboardPeriod(next)) store.setPeriod(next, sources.value, storeKey.value);
}

// Грузим, когда /auth/me и вид магазина ответили, и заново — только если
// набор источников изменился (профиль перечитывается при возврате во вкладку).
const openKeys = computed(() => (ready.value ? sources.value : null));
watch(
  () => openKeys.value?.join(','),
  () => {
    if (openKeys.value !== null) store.load(openKeys.value, storeKey.value);
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader title="Главная" description="Главные показатели магазина — карточки ведут в отчёты">
    <template #filters>
      <OptionGroup
        :model-value="store.period"
        :options="DASHBOARD_PERIOD_OPTIONS"
        label="Период"
        @update:model-value="choosePeriod"
      />
    </template>
  </PageHeader>

  <div class="flex flex-col gap-8">
    <MarketplaceTabs />

    <section aria-label="Показатели" class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiCard
        v-for="kpi in kpis"
        :key="kpi.key"
        :label="kpi.label"
        :icon="ICON[kpi.key]"
        :icon-class="ICON_TONE_CLASS[kpi.iconTone].icon"
        :icon-tile-class="ICON_TONE_CLASS[kpi.iconTone].tile"
        :to="targetOf(kpi)"
        :accent="kpi.accent"
        :value="store.sources[kpi.source].summaries?.[kpi.key]?.value ?? null"
        :caption="store.sources[kpi.source].summaries?.[kpi.key]?.caption"
        :heading="store.sources[kpi.source].summaries?.[kpi.key]?.heading"
        :empty-text="
          store.sources[kpi.source].summaries?.[kpi.key]?.empty
            ? store.sources[kpi.source].summaries?.[kpi.key]?.emptyText
            : null
        "
        :tone="store.sources[kpi.source].summaries?.[kpi.key]?.tone"
        :is-loading="store.sources[kpi.source].isLoading"
        :is-refreshing="store.sources[kpi.source].isRefreshing"
        :saved-at="store.sources[kpi.source].savedAt"
        :error="store.sources[kpi.source].error"
        :loading-text="metaOf(kpi)?.loadingText"
        @retry="store.sources[kpi.source].retry()"
      />
    </section>

    <section
      v-if="showProducts"
      aria-label="Выручка и unit-экономика"
      class="grid items-start gap-3 lg:grid-cols-5"
    >
      <ProfitChartCard
        v-if="showChart"
        :class="[SHINY_CARD, 'lg:col-span-3']"
        :series="profitSource.series"
        :heading="chartHeading"
        :to="targetOf(PROFIT_CHART)"
        :is-loading="profitSource.isLoading"
        :is-refreshing="profitSource.isRefreshing"
        :saved-at="profitSource.savedAt"
        :error="profitSource.error"
        :loading-text="metaOf(PROFIT_CHART)?.loadingText"
        @retry="profitSource.retry()"
      />
      <UnitEconomicsCard
        :class="[SHINY_CARD, showChart ? 'lg:col-span-2' : 'lg:col-span-5']"
        :rows="profitSource.unitEconomics"
        :heading="chartHeading"
        :to="targetOf(PROFIT_CHART)"
        :is-refreshing="profitSource.isRefreshing"
        :saved-at="profitSource.savedAt"
        :error="profitSource.error"
        :loading-text="metaOf(PROFIT_CHART)?.loadingText"
        @retry="profitSource.retry()"
      />
    </section>

    <section v-if="showProducts" aria-label="Товары" class="grid items-start gap-3 lg:grid-cols-3">
      <TopProductsCard
        :class="[SHINY_CARD, 'lg:col-span-2']"
        :rows="topRows"
        :heading="chartHeading"
        :to="targetOf(PROFIT_CHART)"
        :is-refreshing="profitSource.isRefreshing || stocksSource.isRefreshing"
        :saved-at="profitSource.savedAt"
        :error="profitSource.error"
        :loading-text="metaOf(PROFIT_CHART)?.loadingText"
        :stock-note="levels?.problem ?? stocksSource.error"
        @retry="profitSource.retry()"
      />
      <LowStockCard
        :class="SHINY_CARD"
        :rows="lowRows"
        :threshold="levels?.threshold ?? 3"
        :problem="levels?.problem"
        :link="lowStockLink"
        :is-refreshing="stocksSource.isRefreshing"
        :saved-at="stocksSource.savedAt"
        :error="productsError"
        :loading-text="stocksLoadingText"
        @retry="retryProducts"
      />
    </section>

    <section v-if="rowViews.length" aria-label="Заказы">
      <OrdersStatusCard
        :class="SHINY_CARD"
        :rows="rowViews"
        :all-to="ordersOpen ? { name: 'ym-orders' } : null"
        @retry="retryRow"
      />
    </section>

    <section aria-label="Прайс" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <PriceListTile
        :class="SHINY_CARD"
        :info="store.priceList.info"
        :is-loading="store.priceList.isLoading"
        :is-refreshing="store.priceList.isRefreshing"
        :saved-at="store.priceList.savedAt"
        :error="store.priceList.error"
        :link-open="priceListOpen"
        @retry="store.priceList.load()"
      />
    </section>

    <section v-if="links.length" aria-labelledby="dashboard-links" class="flex flex-col gap-3">
      <h2 id="dashboard-links" class="text-sm font-medium text-muted-foreground">Разделы</h2>
      <QuickLinks :items="links" />
    </section>
  </div>
</template>
