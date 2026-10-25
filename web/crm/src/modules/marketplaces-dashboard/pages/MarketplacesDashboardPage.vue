<script setup lang="ts">
/**
 * Дашборд «Площадки» (TASK-191, решение marketplaces_dashboard): подключённые
 * площадки за один период рядом — KPI, выручка во времени, доля в выручке,
 * прибыль, маржа и возвраты. Числа — колонки «Сравнения площадок» и ряд
 * «Аналитики продаж», своих формул нет; общего итога по площадкам нет, как в
 * сравнении. Площадка ведёт в свои «Финансы», показатель — в «Сравнение площадок».
 *
 * Раздел есть в `me.sections`, только когда подключено ≥2 открытых площадок
 * (решает сервер). Под `/ym/…` гард его не закрывает, поэтому прямой адрес без
 * раздела показывает плашку со ссылкой на «Подключения» и задачу не ставит.
 */
import type { DashboardMetric } from '../marketplaces-dashboard.domain';

import { ChartPie, Plug, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import MarketplaceBars from '../components/MarketplaceBars.vue';
import MarketplaceKpiCard from '../components/MarketplaceKpiCard.vue';
import MarketplaceTimeChart from '../components/MarketplaceTimeChart.vue';
import {
  barPoints,
  compareLink,
  dashboardCards,
  grainOf,
  numberedColumns,
  pickMarginPct,
  pickNetRub,
  pickReturnsPct,
  revenueSegments,
  timePoints,
  timeSeries,
} from '../mappers/mapDashboard.marketplaces-dashboard';
import {
  MARKETPLACES_DASHBOARD_FEATURE,
  MARKETPLACES_DASHBOARD_ROUTE_NAME,
} from '../marketplaces-dashboard.domain';
import { useMarketplacesDashboardStore } from '../store/store.marketplaces-dashboard';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentBar } from '@/components/ui/chart';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { CONNECTIONS_ROUTE_NAME } from '@/modules/marketplaces/marketplaces.domain';
import { MarketplaceJournalPulls } from '@/shared/finance-journal';
import { RangePicker, rangeLabel, useLinkedRange } from '@/shared/period';
import { formatKopecks, formatRub } from '@/shared/utils';

const FINANCE_FEATURE = 'finance';

const store = useMarketplacesDashboardStore();
const auth = useAuthStore();
const { data, isRefreshing, savedAt, error } = storeToRefs(store);

const ready = computed(() => auth.me !== null);
const featureOpen = computed(
  () =>
    auth.me?.features?.[MARKETPLACES_DASHBOARD_FEATURE] === true &&
    auth.me.features[FINANCE_FEATURE] === true,
);
const visible = computed(
  () => auth.me?.sections.includes(MARKETPLACES_DASHBOARD_ROUTE_NAME) === true,
);

const metric = ref<DashboardMetric>('revenue');

const cards = computed(() => (data.value ? dashboardCards(data.value) : []));
const withNumbers = computed(() => (data.value ? numberedColumns(data.value).length : 0));
const segments = computed(() => (data.value ? revenueSegments(data.value) : []));
const series = computed(() => (data.value ? timeSeries(data.value) : []));
const points = computed(() =>
  data.value ? timePoints(data.value, metric.value, grainOf(data.value.period)) : [],
);
const net = computed(() => (data.value ? barPoints(data.value, pickNetRub) : []));
const margin = computed(() => (data.value ? barPoints(data.value, pickMarginPct) : []));
const returns = computed(() => (data.value ? barPoints(data.value, pickReturnsPct) : []));
const compareTo = computed(() => (data.value ? compareLink(data.value.period) : {}));

const percent = (value: number): string => `${value.toFixed(1).replace('.', ',')} %`;

useLinkedRange((range) => store.chooseCustom(range));

watch(
  () =>
    ready.value && featureOpen.value && visible.value && store.request
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
    title="Площадки"
    description="Подключённые площадки за один период рядом: выручка, прибыль, маржа и возвраты"
  >
    <template v-if="visible" #filters>
      <RangePicker
        :preset="store.preset"
        :custom="store.custom"
        @preset="store.choosePreset($event)"
        @custom="store.chooseCustom($event)"
      />
    </template>
  </PageHeader>

  <Skeleton v-if="!ready" class="h-40 w-full" />

  <Alert v-else-if="!featureOpen">
    Дашборд «Площадки» пока закрыт — его открывает администратор вместе с «Финансами».
  </Alert>

  <EmptyState
    v-else-if="!visible"
    :icon="Plug"
    title="Подключите вторую площадку"
    description="Дашборд сравнивает площадки между собой — он появится, когда подключено и открыто больше одной."
  >
    <Button as-child variant="outline" class="mt-2">
      <RouterLink :to="{ name: CONNECTIONS_ROUTE_NAME }">Открыть «Подключения»</RouterLink>
    </Button>
  </EmptyState>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Собираю показатели площадок из журнала…</p>
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Skeleton v-for="n in 2" :key="n" class="h-64 w-full" />
    </div>
    <Skeleton class="h-72 w-full" />
  </div>

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.retry()"
    />

    <p class="text-sm text-muted-foreground">
      <span class="tnum">{{ rangeLabel(data.period) }}</span>
      · подробности и выводы —
      <RouterLink :to="compareTo" class="underline hover:text-foreground">
        «Сравнение площадок»
      </RouterLink>
    </p>

    <section aria-label="Показатели площадок" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <MarketplaceKpiCard
        v-for="card in cards"
        :key="card.marketplace"
        :card="card"
        :compare-to="compareTo"
      />
    </section>

    <MarketplaceJournalPulls :columns="data.columns" :range="data.period" @loaded="store.retry()" />

    <EmptyState
      v-if="withNumbers < 2"
      :icon="ChartPie"
      title="Графикам пока не хватает данных"
      description="Графики сравнивают площадки, а журнал за этот период загружен меньше чем у двух — причины в карточках выше."
    />

    <template v-else>
      <MarketplaceTimeChart
        :points="points"
        :series="series"
        :metric="metric"
        @metric="metric = $event"
      />

      <div class="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-base">
              <RouterLink :to="compareTo" class="hover:underline">Доля в выручке</RouterLink>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SegmentBar
              v-if="segments.length >= 2"
              :segments="segments"
              label="Выручка площадок за период"
              :format="formatKopecks"
            />
            <p v-else class="text-sm text-muted-foreground">
              Выручка за период есть только у одной площадки.
            </p>
          </CardContent>
        </Card>
        <MarketplaceBars
          title="Чистая прибыль"
          label="Чистая прибыль площадок за период"
          :points="net"
          :format="formatRub"
          :to="compareTo"
        />
        <MarketplaceBars
          title="Маржа"
          label="Чистая маржа площадок за период, процент выручки"
          :points="margin"
          :format="percent"
          :to="compareTo"
        />
        <MarketplaceBars
          title="Возвраты, % продаж"
          label="Возвраты площадок в процентах от продаж за период"
          :points="returns"
          :format="percent"
          :to="compareTo"
        />
      </div>
    </template>

    <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
      <li v-for="note in data.notes" :key="note">{{ note }}</li>
    </ul>
  </div>
</template>
