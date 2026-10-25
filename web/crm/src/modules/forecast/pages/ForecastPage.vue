<script setup lang="ts">
/**
 * «Прогнозы» (TASK-151, ТЗ п.13): до конца месяца — выручка, чистая, штуки,
 * возвраты, налог и поступления; до конца года — продажи и налог; динамика
 * рентабельности; what-if по комиссии; необходимые закупки по кнопке. Каждое
 * число-прогноз помечено, метод — строкой из ответа сервера.
 */
import type { BasisDays } from '../forecast.domain';

import { RotateCw, TrendingUp } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import ForecastCards from '../components/ForecastCards.vue';
import InflowCard from '../components/InflowCard.vue';
import MarginBars from '../components/MarginBars.vue';
import PurchasesTable from '../components/PurchasesTable.vue';
import WhatIfCard from '../components/WhatIfCard.vue';
import {
  BASIS_OPTIONS,
  DEFAULT_TAX_NOTE,
  FINANCE_FEATURE,
  FORECAST_NOTE,
  MAX_COVER_DAYS,
  MIN_COVER_DAYS,
  NO_COST_NOTE,
  PRICE_CALCULATOR_ROUTE,
  WHAT_IF_LIMIT_PP,
} from '../forecast.domain';
import {
  formatShare,
  marginBars,
  monthCards,
  purchaseView,
  whatIfOf,
  yearCards,
} from '../mappers/mapForecast.forecast';
import { useForecastStore } from '../store/store.forecast';

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
import { useMarketplace } from '@/shared/composables';
import { JournalPull, useFinanceJournal } from '@/shared/finance-journal';
import { shiftDay } from '@/shared/period';
import { formatCount, formatKopecks, formatSavedAt } from '@/shared/utils';

const store = useForecastStore();
const auth = useAuthStore();
const routeMarketplace = useMarketplace();
const marketplace = computed(() => routeMarketplace.value ?? 'ym');
store.selectMarketplace(marketplace.value);
const {
  data,
  isRefreshing,
  savedAt,
  error,
  basisDays,
  coverDays,
  whatIfPp,
  purchases,
  purchasesLoading,
  purchasesError,
} = storeToRefs(store);

const ready = computed(() => auth.me !== null);
const withFinance = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);
const withCalculator = computed(() => auth.me?.sections.includes(PRICE_CALCULATOR_ROUTE) === true);

const forecast = computed(() => data.value?.forecast ?? null);

// Прогноз — по журналу последних дней и месяца: не загружен — «Загрузить из Маркета».
const journal = useFinanceJournal(
  () =>
    data.value
      ? {
          marketplace: marketplace.value,
          from: shiftDay(data.value.today, -data.value.basisDays),
          to: data.value.today,
        }
      : null,
  () => store.load(),
);
const month = computed(() => (forecast.value ? monthCards(forecast.value) : []));
const year = computed(() => (forecast.value ? yearCards(forecast.value) : []));
const margins = computed(() => (forecast.value ? marginBars(forecast.value) : []));
const whatIf = computed(() => (forecast.value ? whatIfOf(forecast.value, whatIfPp.value) : null));
const purchaseRows = computed(() => purchases.value?.rows?.map(purchaseView) ?? []);
const purchasesTaken = computed(() =>
  purchases.value ? formatSavedAt(purchases.value.takenAt) : null,
);

function setPp(raw: string | number | undefined): void {
  const value = Number(String(raw).replace(',', '.'));
  if (Number.isFinite(value)) {
    store.setWhatIfPp(Math.max(-WHAT_IF_LIMIT_PP, Math.min(WHAT_IF_LIMIT_PP, value)));
  }
}

function setCover(raw: string | number | undefined): void {
  const value = Math.round(Number(raw));
  if (Number.isFinite(value)) {
    store.setCoverDays(Math.max(MIN_COVER_DAYS, Math.min(MAX_COVER_DAYS, value)));
  }
}

// Площадка из адреса — в ключе: /ym/forecast → /ozon/forecast пересчитывает по Ozon.
watch(
  () => (ready.value && withFinance.value ? `${marketplace.value}:${basisDays.value}` : null),
  (key) => {
    if (key === null) return;
    store.selectMarketplace(marketplace.value);
    store.load();
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader title="Прогнозы" description="До конца месяца и года — линейно по последним дням">
    <template #filters>
      <OptionGroup
        :model-value="String(basisDays)"
        :options="BASIS_OPTIONS"
        label="Окно базы"
        @update:model-value="store.setBasisDays(Number($event) as BasisDays)"
      />
    </template>
  </PageHeader>

  <Alert v-if="ready && !withFinance">
    Прогноз строится по финансовому журналу — откройте «Финансы» у администратора.
  </Alert>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Считаю прогноз по журналу…</p>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Skeleton v-for="i in 5" :key="i" class="h-28" />
    </div>
    <Skeleton class="h-48 w-full" />
  </div>

  <EmptyState
    v-else-if="!forecast"
    :icon="TrendingUp"
    title="Прогноза нет"
    :description="data.reason ?? ''"
  >
    <JournalPull :journal="journal" only-missing class="mt-2 w-full max-w-md text-left" />
  </EmptyState>

  <div v-else class="flex flex-col gap-6">
    <JournalPull :journal="journal" only-missing />

    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.retry()"
    />

    <p class="text-sm text-muted-foreground">
      <Badge variant="outline">метод</Badge>
      {{ forecast.method.text }}
    </p>

    <section class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">До конца месяца</h2>
      <ForecastCards :cards="month" />
      <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          Рентабельность по чистой:
          <span class="tnum text-foreground">{{ formatShare(forecast.month.netMargin) }}</span>
        </span>
        <span>
          Налоговая нагрузка:
          <span class="tnum text-foreground">{{ formatShare(forecast.taxShare) }}</span> выручки
        </span>
        <span>
          Возвраты:
          <span class="tnum text-foreground">{{ formatShare(forecast.returnsShare) }}</span> продаж
        </span>
      </div>
    </section>

    <div class="grid gap-3 lg:grid-cols-2">
      <InflowCard :inflow="forecast.inflow" />
      <WhatIfCard v-if="whatIf" :view="whatIf" :with-calculator="withCalculator" @change="setPp" />
    </div>

    <section class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">До конца {{ forecast.year.year }} года</h2>
      <ForecastCards :cards="year" />
    </section>

    <Card>
      <CardHeader>
        <CardTitle>Рентабельность по месяцам</CardTitle>
      </CardHeader>
      <CardContent>
        <MarginBars :bars="margins" />
      </CardContent>
    </Card>

    <section class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Необходимые закупки</h2>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <label class="flex items-center gap-2">
          <span>Запас на</span>
          <Input
            :model-value="String(coverDays)"
            type="number"
            :min="MIN_COVER_DAYS"
            :max="MAX_COVER_DAYS"
            class="h-9 w-20"
            aria-label="Дней запаса"
            @update:model-value="setCover($event)"
          />
          <span>дней</span>
        </label>
        <Button :disabled="purchasesLoading" @click="store.loadPurchases()">
          <RotateCw v-if="purchasesLoading" class="animate-spin" />
          Рассчитать закупки
        </Button>
        <span class="text-muted-foreground">
          {{
            marketplace === 'ym'
              ? 'Остатки берутся у Маркета по всем магазинам — это займёт время.'
              : 'Остатки берутся у площадки по всем её складам — это займёт время.'
          }}
        </span>
      </div>
      <Alert v-if="purchasesError">{{ purchasesError }}</Alert>
      <template v-if="purchases">
        <p v-if="purchases.reason" class="text-sm text-muted-foreground">{{ purchases.reason }}</p>
        <template v-else>
          <p class="text-sm text-muted-foreground">
            Докупить {{ formatCount(purchases.totalUnits) }} шт. на
            {{ formatKopecks(purchases.totalKopecks) }}
            <template v-if="purchases.withoutCost.skus">
              · у {{ purchases.withoutCost.skus }} тов. нет закупа ({{
                formatCount(purchases.withoutCost.units)
              }}
              шт.)
            </template>
            <template v-if="purchasesTaken"> · остатки {{ purchasesTaken }}</template>
          </p>
          <Alert v-for="p in purchases.problems" :key="p.storeName">
            {{ p.storeName }}: {{ p.problem }}
          </Alert>
          <PurchasesTable v-if="purchaseRows.length" :rows="purchaseRows" />
        </template>
      </template>
    </section>

    <p class="text-xs text-muted-foreground">
      {{ FORECAST_NOTE }}
      <template v-if="!forecast.unconfirmed.confirmed">{{ NO_COST_NOTE }}</template>
      <template v-if="forecast.taxIsDefault">{{ DEFAULT_TAX_NOTE }}</template>
    </p>
  </div>
</template>
