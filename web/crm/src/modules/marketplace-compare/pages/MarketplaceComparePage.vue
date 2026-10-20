<script setup lang="ts">
/**
 * «Сравнение площадок» (TASK-137, ТЗ п.2): P&L Яндекс Маркета, Ozon и
 * Wildberries за один период рядом, с одинаковыми правилами учёта (налог по
 * начислению, операционные расходы по доле выручки — оговорки печатает сервер)
 * и выводами — сравнениями чисел, не ИИ. Ячейка ведёт в «Прибыль» своей
 * площадки за тот же период.
 */
import { RotateCw, Scale } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import CompareConclusions from '../components/CompareConclusions.vue';
import CompareTable from '../components/CompareTable.vue';
import SchemeTable from '../components/SchemeTable.vue';
import {
  compareRows,
  costSharePoints,
  numberedColumns,
  percentLabel,
  revenueSegments,
  schemeRows,
} from '../mappers/mapCompare.marketplace-compare';
import { FINANCE_FEATURE } from '../marketplace-compare.domain';
import { useMarketplaceCompareStore } from '../store/store.marketplace-compare';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, SegmentBar } from '@/components/ui/chart';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { RangePicker, rangeLabel, useLinkedRange } from '@/shared/period';
import { formatKopecks } from '@/shared/utils';

const store = useMarketplaceCompareStore();
const auth = useAuthStore();
const { data, isRefreshing, savedAt, error } = storeToRefs(store);

const ready = computed(() => auth.me !== null);
const withFinance = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);

const rows = computed(() => (data.value ? compareRows(data.value) : []));
const schemes = computed(() => (data.value ? schemeRows(data.value) : []));
const segments = computed(() => (data.value ? revenueSegments(data.value) : []));
const costShares = computed(() => (data.value ? costSharePoints(data.value) : []));
const withNumbers = computed(() => (data.value ? numberedColumns(data.value) : 0));

useLinkedRange((range) => store.chooseCustom(range));

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
    title="Сравнение площадок"
    description="Выручка, расходы, возвраты и чистая прибыль площадок за один период — с выводами, где выгоднее"
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
    Площадки сравниваются по финансовому журналу — откройте «Финансы» у администратора.
  </Alert>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Собираю P&amp;L площадок из журнала…</p>
    <Skeleton class="h-96 w-full" />
    <Skeleton class="h-40 w-full" />
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
      · рост — к периоду <span class="tnum">{{ rangeLabel(data.previousPeriod) }}</span>
    </p>

    <EmptyState
      v-if="withNumbers === 0"
      :icon="Scale"
      title="Сравнивать пока нечего"
      description="Ни у одной площадки нет загруженного журнала за этот период — причины в колонках ниже."
    />

    <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
      <li v-for="note in data.notes" :key="note">{{ note }}</li>
      <li v-if="data.operatingExpensesKopecks !== 0">
        Операционные расходы кабинета за период:
        <span class="tnum">{{ formatKopecks(data.operatingExpensesKopecks) }}</span>
      </li>
      <li v-if="data.taxIsDefault">
        Налоговые настройки не подтверждены — налог посчитан по умолчанию, проверьте раздел
        «Налоги».
      </li>
    </ul>

    <CompareTable :columns="data.columns" :rows="rows" />

    <div v-if="withNumbers >= 2" class="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Доля выручки</CardTitle>
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
      <Card>
        <CardHeader>
          <CardTitle>Услуги площадки, % выручки</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart
            :points="costShares"
            label="Услуги и удержания площадки в процентах от выручки"
            :format="percentLabel"
            :height="200"
          />
        </CardContent>
      </Card>
    </div>

    <CompareConclusions :data="data" :conclusions="data.conclusions" />

    <section v-if="schemes.length" aria-label="Схемы продаж" class="flex flex-col gap-3">
      <h2 class="text-sm font-semibold">Схемы продаж</h2>
      <SchemeTable :rows="schemes" />
    </section>
  </div>
</template>
