<script setup lang="ts">
/**
 * «Рейтинги и классификации» (TASK-141, ТЗ п.9): ТОП-20 товаров по выручке,
 * прибыли, штукам и рентабельности, убыточные, растущий и падающий спрос, классы
 * ABC и XYZ. Числа — тот же P&L, что «Финансы»; пороги классов — из ответа.
 */
import type { RatingTopKey } from '../sku-ratings.domain';

import { RotateCw, Trophy } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import ClassTable from '../components/ClassTable.vue';
import RatingTopTable from '../components/RatingTopTable.vue';
import {
  classRow,
  summaryRows,
  thresholdLines,
  topRow,
} from '../mappers/mapSkuRatings.sku-ratings';
import {
  ABC_FILTER_OPTIONS,
  DEMAND_NOTE,
  FINANCE_FEATURE,
  NO_COST_NOTE,
  TOP_METRIC,
  XYZ_FILTER_OPTIONS,
} from '../sku-ratings.domain';
import { useSkuRatingsStore } from '../store/store.sku-ratings';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { ALL_MARKETPLACES } from '@/navigation';
import { sectionName } from '@/navigation.sections';
import { useMarketplace } from '@/shared/composables';
import { JournalPull, useFinanceJournal } from '@/shared/finance-journal';
import { RangePicker, rangeLabel, rangeQuery } from '@/shared/period';

const store = useSkuRatingsStore();
const auth = useAuthStore();
// Площадка — из адреса (`/<площадка>/…`, TASK-181): журнал и товары своей площадки.
const routeMarketplace = useMarketplace();
const marketplace = computed(() => routeMarketplace.value ?? 'ym');
store.selectMarketplace(marketplace.value);

// Журнал периода не загружен — баннер с «Загрузить из Маркета», а не пустой экран.
const journal = useFinanceJournal(
  () => (store.range ? { marketplace: marketplace.value, ...store.range } : null),
  () => store.load(),
);
// Подпись источника: у ЯМ — прежняя («журнал Маркета»), у Ozon/WB — имя площадки.
const source = computed(() => {
  if (marketplace.value === 'ym') return { of: 'Маркета', name: 'Маркет' };
  const label = ALL_MARKETPLACES.find((m) => m.key === marketplace.value)?.label ?? '';
  return { of: label, name: label };
});
const { data, isRefreshing, savedAt, error, top, abc, xyz, query, visibleSkus } =
  storeToRefs(store);

const ready = computed(() => auth.me !== null);
const withFinance = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);

const periodLabel = computed(() => (store.range ? rangeLabel(store.range) : ''));
const topOptions = computed(() =>
  (data.value?.tops ?? []).map((t) => ({ value: t.key, label: t.title })),
);
const current = computed(() => data.value?.tops.find((t) => t.key === top.value) ?? null);
const topRows = computed(() => current.value?.rows.map(topRow) ?? []);
const classRows = computed(() => visibleSkus.value.map(classRow));
const lines = computed(() => (data.value ? thresholdLines(data.value.thresholds) : null));
const withXyz = computed(() => data.value !== null && data.value.xyzUnavailable === null);
const isEmpty = computed(() => data.value !== null && data.value.skus.length === 0);
const hasNoCost = computed(() => data.value?.skus.some((s) => !s.costKnown) ?? false);
const summaries = computed(() =>
  data.value
    ? [
        {
          key: 'abcRevenue',
          title: 'ABC по выручке',
          rows: summaryRows(data.value.abcRevenue, 'выручки'),
        },
        {
          key: 'abcProfit',
          title: 'ABC по прибыли',
          rows: summaryRows(data.value.abcProfit, 'прибыли'),
        },
        ...(withXyz.value
          ? [{ key: 'xyz', title: 'XYZ по спросу', rows: summaryRows(data.value.xyz, 'выручки') }]
          : []),
      ]
    : [],
);
const financeLink = computed(() =>
  store.range
    ? {
        name: sectionName(marketplace.value, 'finance'),
        params: { tab: 'pnl' },
        query: rangeQuery(store.range),
      }
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
      ? `${marketplace.value}:${store.request.range.from}:${store.request.range.to}`
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
    title="Рейтинги товаров"
    description="ТОП-20 по выручке, прибыли и спросу, классы ABC и XYZ"
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
    Рейтинги считаются по финансовому журналу — откройте «Финансы» у администратора.
  </Alert>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Собираю товары из журнала…</p>
    <div class="grid gap-3 md:grid-cols-3">
      <Skeleton v-for="i in 3" :key="i" class="h-28" />
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
        числа как в
        <RouterLink v-if="financeLink" :to="financeLink" class="text-foreground underline">
          «Финансах»
        </RouterLink>
        · спрос к периоду {{ rangeLabel(data.previousPeriod) }}
      </span>
    </div>

    <JournalPull :journal="journal" />

    <EmptyState
      v-if="isEmpty"
      :icon="Trophy"
      title="За период продаж нет"
      :description="`Журнал ${source.of} за эти даты пуст или ещё не загружен.`"
    />

    <template v-else>
      <div class="grid gap-3 md:grid-cols-3">
        <Card v-for="summary in summaries" :key="summary.key">
          <CardHeader>
            <CardTitle>{{ summary.title }}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl class="flex flex-col gap-1.5 text-sm">
              <div v-for="row in summary.rows" :key="row.key" class="flex items-baseline gap-2">
                <dt class="w-5 font-medium">{{ row.key }}</dt>
                <dd class="tnum">{{ row.count }}</dd>
                <dd class="tnum ml-auto text-muted-foreground">{{ row.share }}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card v-if="!withXyz">
          <CardHeader>
            <CardTitle>XYZ по спросу</CardTitle>
          </CardHeader>
          <CardContent class="text-sm text-muted-foreground">{{ data.xyzUnavailable }}</CardContent>
        </Card>
      </div>

      <section class="flex flex-col gap-3">
        <h2 class="text-base font-semibold">ТОП-{{ data.thresholds.topSize }}</h2>
        <OptionGroup
          :model-value="top"
          :options="topOptions"
          label="Рейтинг"
          @update:model-value="store.setTop($event as RatingTopKey)"
        />
        <RatingTopTable v-if="topRows.length" :rows="topRows" :metric="TOP_METRIC[top]" />
        <p v-else class="text-sm text-muted-foreground">В этом рейтинге за период товаров нет.</p>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-base font-semibold">Классы товаров</h2>
        <div class="flex flex-wrap items-center gap-3">
          <Input
            :model-value="query"
            class="h-9 w-72"
            placeholder="Название или артикул"
            aria-label="Поиск товара"
            @update:model-value="store.setQuery(String($event))"
          />
          <OptionGroup
            :model-value="abc"
            :options="ABC_FILTER_OPTIONS"
            label="ABC выручки"
            @update:model-value="store.setAbc($event)"
          />
          <OptionGroup
            v-if="withXyz"
            :model-value="xyz"
            :options="XYZ_FILTER_OPTIONS"
            label="XYZ"
            @update:model-value="store.setXyz($event)"
          />
        </div>
        <ClassTable v-if="classRows.length" :rows="classRows" :with-xyz="withXyz" />
        <p v-else class="text-sm text-muted-foreground">Ничего не найдено.</p>
      </section>

      <Card v-if="lines">
        <CardHeader>
          <CardTitle>Как считаются классы</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-4 text-sm md:grid-cols-2">
          <ul class="flex flex-col gap-1">
            <li v-for="line in lines.abc" :key="line">{{ line }}</li>
            <li class="text-muted-foreground">ABC по выручке и отдельно по чистой прибыли.</li>
          </ul>
          <ul class="flex flex-col gap-1">
            <li v-for="line in lines.xyz" :key="line">{{ line }}</li>
            <li v-for="line in lines.rules" :key="line" class="text-muted-foreground">
              {{ line }}
            </li>
          </ul>
        </CardContent>
      </Card>

      <p class="text-xs text-muted-foreground">
        {{ DEMAND_NOTE }}
        <template v-if="hasNoCost">{{ NO_COST_NOTE }}</template>
        <template v-if="data.status !== 'verified'">
          Числа могут измениться, пока {{ source.name }} не закрыл период.
        </template>
      </p>
    </template>
  </div>
</template>
