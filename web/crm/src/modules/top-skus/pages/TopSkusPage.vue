<script setup lang="ts">
/**
 * «Топ товаров»: ВСЕ проданные товары магазина за выбранный период — те же числа, что
 * «Прибыль» и кнопка «🏆 Топ товаров» бота (один ProfitService). Плюс
 * вкладки «Регионы» (покупателей) и «Кластеры» (склады отгрузки).
 */
import { RotateCw, Trophy } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import TopPlacesTable from '../components/TopPlacesTable.vue';
import TopSkusTable from '../components/TopSkusTable.vue';
import { useTopSkusTabs } from '../composables/useTopSkusTabs.top-skus';
import { useTopSkusStore } from '../store/store.top-skus';
import { TOP_SKUS_SORT_OPTIONS } from '../top-skus.domain';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStoreKey } from '@/shared/composables';
import { RangePicker, useLinkedRange } from '@/shared/period';
import { formatCount, formatRub } from '@/shared/utils';

const store = useTopSkusStore();
const storeKey = useStoreKey();
const {
  data,
  skus,
  soldCount,
  regions,
  clusters,
  query,
  sort,
  range,
  isRefreshing,
  savedAt,
  error,
} = storeToRefs(store);
const { open, activeKey, places, deepHistory } = useTopSkusTabs();

// Ссылка «Все товары» с Главной может принести период в query — до первой загрузки.
useLinkedRange((linked) => store.chooseCustom(linked));

watch(
  [range, storeKey],
  ([next, key]) => {
    if (next !== null && key) store.load(key);
  },
  { immediate: true },
);

const isEmpty = computed(() => data.value !== null && soldCount.value === 0);
</script>

<template>
  <PageHeader
    title="Топ товаров"
    :description="
      data ? `${data.periodTitle}, ${data.scopeLabel}` : 'Все проданные товары за период'
    "
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

  <p v-if="!deepHistory" class="text-xs text-muted-foreground">
    Маркет отдаёт заказы не старше 30 дней — более ранний период откроет администратор.
  </p>

  <div v-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Собираю заказы из Маркета…</p>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Skeleton v-for="i in 4" :key="i" class="h-24" />
    </div>
    <Skeleton class="h-64 w-full" />
  </div>

  <div v-else class="flex flex-col gap-6">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.retry()"
    />

    <EmptyState v-if="isEmpty" :icon="Trophy" :title="data.emptyText" />

    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Товаров продано" :value="formatCount(soldCount)" />
        <KpiCard label="Заказов" :value="formatCount(data.orders)" />
        <KpiCard label="Продажи" :value="formatRub(data.revenue)" />
        <KpiCard label="Чистая" :value="formatRub(data.net)" />
      </div>

      <Alert v-if="data.unconfirmedOrders">
        Без закупочной цены: {{ formatCount(data.unconfirmedOrders) }} заказ(ов) — в топе их нет.
        Загрузите прайс с этими товарами.
      </Alert>

      <Tabs v-if="open.length > 1" v-model="activeKey">
        <TabsList>
          <TabsTrigger v-for="tab in open" :key="tab.key" :value="tab.key">
            {{ tab.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <template v-if="activeKey === 'regions'">
        <TopPlacesTable :rows="regions" title="Регион покупателя" />
      </template>
      <template v-else-if="activeKey === 'clusters'">
        <TopPlacesTable :rows="clusters" title="Кластер отгрузки" />
        <p class="text-xs text-muted-foreground">
          Кластер — по складу Маркета, с которого ушёл товар; у FBS-магазина отгрузка всегда со
          своего склада.
        </p>
      </template>
      <template v-else>
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
            :options="TOP_SKUS_SORT_OPTIONS"
            label="Сортировка"
            @update:model-value="store.setSort($event)"
          />
        </div>
        <TopSkusTable v-if="skus.length" :rows="skus" :places="places" />
        <p v-else class="text-sm text-muted-foreground">Ничего не найдено.</p>
      </template>
    </template>
  </div>
</template>
