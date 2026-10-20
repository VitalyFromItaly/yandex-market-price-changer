<script setup lang="ts">
/**
 * «Unit-экономика» (TASK-138, ТЗ п.7): прибыль по каждому товару за период из
 * финжурнала — тот же P&L, что «Финансы», разложенный по товарам. Строка
 * «не относится к товару» замыкает сумму: с ней итог равен чистой прибыли
 * «Финансов» за тот же период (ссылка ведёт туда с тем же периодом).
 */
import { Calculator, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import UnitSkuCard from '../components/UnitSkuCard.vue';
import UnitSkuTable from '../components/UnitSkuTable.vue';
import { toUnitRow, unconfirmedNote } from '../mappers/mapUnitEconomics.unit-economics';
import { useUnitEconomicsStore } from '../store/store.unit-economics';
import {
  FINANCE_FEATURE,
  PRICE_CALCULATOR_ROUTE,
  REST_NOTE,
  UNIT_SORT_OPTIONS,
} from '../unit-economics.domain';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { RangePicker, rangeLabel, rangeQuery } from '@/shared/period';
import { formatCount, formatKopecks, plural } from '@/shared/utils';

const store = useUnitEconomicsStore();
const auth = useAuthStore();
const { data, isRefreshing, savedAt, error, visible, opened, query, sort } = storeToRefs(store);

const ready = computed(() => auth.me !== null);
const withFinance = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);
const withCalculator = computed(() => auth.me?.sections.includes(PRICE_CALCULATOR_ROUTE) === true);

const rows = computed(() => visible.value.map(toUnitRow));
const periodLabel = computed(() => (store.range ? rangeLabel(store.range) : ''));
const unconfirmed = computed(() => (data.value ? unconfirmedNote(data.value) : null));
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
    title="Unit-экономика"
    description="Прибыль, расходы и минимальная цена по каждому товару — из финансового журнала Маркета"
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
    Прибыль по товарам считается по финансовому журналу — откройте «Финансы» у администратора.
  </Alert>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Раскладываю журнал по товарам…</p>
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

    <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span class="tnum">{{ periodLabel }}</span>
      <Badge :variant="statusTone">{{ data.statusLabel }}</Badge>
      <span>
        чистая прибыль
        <RouterLink
          v-if="financeLink"
          :to="financeLink"
          class="font-medium text-foreground underline"
        >
          {{ formatKopecks(data.netKopecks) }}
        </RouterLink>
        · {{ formatCount(data.skus.length) }}
        {{ plural(data.skus.length, ['товар', 'товара', 'товаров']) }}
      </span>
    </div>

    <Alert v-if="unconfirmed">{{ unconfirmed }}</Alert>

    <EmptyState
      v-if="data.skus.length === 0"
      :icon="Calculator"
      title="За период нет операций по товарам"
      description="Журнал Маркета за эти даты пуст или ещё не загружен."
    />

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
          :options="UNIT_SORT_OPTIONS"
          label="Сортировка"
          @update:model-value="store.setSort($event)"
        />
      </div>

      <UnitSkuTable v-if="rows.length" :rows="rows" @open="store.open($event)" />
      <p v-else class="text-sm text-muted-foreground">Ничего не найдено.</p>

      <Card class="flex flex-col gap-1 p-4 text-sm">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="font-medium">Не относится к товару</span>
          <span class="tabular-nums font-medium">{{ formatKopecks(data.rest.netKopecks) }}</span>
        </div>
        <p class="text-xs text-muted-foreground">
          {{ REST_NOTE }}
          <template v-if="data.rest.operatingKopecks">
            Операционные расходы — {{ formatKopecks(data.rest.operatingKopecks) }}.
          </template>
          <template v-if="data.rest.lines">
            Строк журнала без товара: {{ formatCount(data.rest.lines) }}.
          </template>
        </p>
      </Card>

      <p v-if="data.previousPeriod" class="text-xs text-muted-foreground">
        «К прошлому» — изменение прибыли товара к периоду
        {{ rangeLabel(data.previousPeriod) }}.
        <template v-if="data.status !== 'verified'">
          Числа могут измениться, пока Маркет не закрыл период.
        </template>
      </p>
    </template>
  </div>

  <UnitSkuCard
    :sku="opened"
    :period-label="periodLabel"
    :with-calculator="withCalculator"
    @close="store.close()"
  />
</template>
