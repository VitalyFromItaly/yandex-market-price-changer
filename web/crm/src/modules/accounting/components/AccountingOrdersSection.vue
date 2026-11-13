<script setup lang="ts">
/**
 * Заказы «Финучёта» (TASK-223, API — TASK-222): заказы месяца оформления магазина
 * с состоянием прибыли (Прогноз / Предварительно / Сверено), подтверждённое и
 * ожидаемое раздельно; клик — карточка заказа. Фоновые задачи, не GET; числа и
 * состояния — с сервера.
 */
import type { AccountingOrderRow } from '../accounting.domain';

import { ListOrdered } from 'lucide-vue-next';
import { computed, onMounted, watch } from 'vue';

import {
  ALL_OPTION,
  useAccountingOrdersFilters,
} from '../composables/useAccountingOrdersFilters.accounting';
import { useAccountingStore } from '../store/store.accounting';

import AccountingOrderCard from './AccountingOrderCard.vue';
import AccountingOrdersTable from './AccountingOrdersTable.vue';
import OrdersStorePicker from './OrdersStorePicker.vue';
import ReconcileMonthPicker from './ReconcileMonthPicker.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { OptionGroup } from '@/components/ui/option-group';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoresStore } from '@/modules/stores/store/store.stores';

const store = useAccountingStore();
const stores = useStoresStore();
const storeOptions = computed(() =>
  (stores.stores ?? []).map((s) => ({ key: s.key, label: s.label })),
);
const filters = useAccountingOrdersFilters(() => storeOptions.value);
const { month, marketplace, state, lossOnly } = filters;

const view = computed(() => store.orders);
const withAll = (options: { value: string; label: string }[]) => [
  { value: ALL_OPTION, label: 'Все' },
  ...options,
];
const marketplaceOptions = computed(() => withAll(view.value?.marketplaceOptions ?? []));
const stateOptions = computed(() => withAll(view.value?.stateOptions ?? []));

onMounted(() => void stores.loadList());
watch(
  filters.request,
  (request) => {
    if (request) void store.loadOrders(request);
  },
  { immediate: true, deep: true },
);

function openOrder(row: AccountingOrderRow): void {
  const current = filters.store.value;
  if (!current) return;
  void store.openOrder({ store: current.key, marketplace: row.marketplace, orderId: row.orderId });
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-base font-semibold">Заказы и прибыль</h2>
        <p class="text-sm text-muted-foreground">
          Прибыль каждого заказа по журналу площадки: что подтверждено и что ещё ожидается.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <OrdersStorePicker
          v-if="storeOptions.length > 1"
          :options="storeOptions"
          :selected="filters.store.value?.key ?? null"
          :label="filters.store.value?.label ?? 'Магазин'"
          @select="filters.selectStore"
        />
        <ReconcileMonthPicker
          v-model="month"
          :options="filters.monthOptions"
          :label="filters.monthTitle.value"
          aria-label="Месяц оформления"
        />
      </div>
    </div>

    <div v-if="view" class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <OptionGroup
        v-if="view.marketplaceOptions.length > 1"
        v-model="marketplace"
        :options="marketplaceOptions"
        label="Площадка"
      />
      <OptionGroup v-model="state" :options="stateOptions" label="Состояние прибыли" />
      <Checkbox v-model="lossOnly" label="Только убыточные" />
    </div>

    <Alert v-if="stores.listError && !storeOptions.length">
      Не удалось загрузить магазины: {{ stores.listError }}
    </Alert>
    <EmptyState
      v-else-if="!stores.listLoading && stores.stores !== null && !storeOptions.length"
      :icon="ListOrdered"
      title="Нет магазинов"
      description="Подключите Яндекс Маркет в разделе «Подключения» — заказы появятся после загрузки."
    />

    <Alert v-else-if="store.ordersError && !view">
      {{ store.ordersError }}
      <Button variant="outline" size="sm" class="ml-2" @click="store.retryOrders()"
        >Повторить</Button
      >
    </Alert>

    <div v-else-if="!view" class="flex flex-col gap-3">
      <div class="grid gap-3 sm:grid-cols-3">
        <Skeleton class="h-20" />
        <Skeleton class="h-20" />
        <Skeleton class="h-20" />
      </div>
      <Skeleton class="h-72" />
    </div>

    <template v-else>
      <RefreshIndicator
        :refreshing="store.ordersRefreshing"
        :saved-at="store.ordersSavedAt"
        :error="store.ordersError"
        @retry="store.retryOrders()"
      />
      <div class="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Подтверждено"
          :value="view.totals.confirmedLabel"
          :caption="view.totals.countLabel"
          :heading="view.periodLabel"
        />
        <KpiCard
          label="Ожидается"
          :value="view.totals.expectedLabel"
          :caption="view.costMethodLabel"
        />
        <KpiCard
          :label="view.totals.netTitle"
          :value="view.totals.netLabel"
          :caption="view.totals.netCaption"
        />
      </div>
      <p v-if="view.totals.unallocatedLabel" class="text-sm text-muted-foreground">
        {{ view.totals.unallocatedLabel }}
      </p>

      <EmptyState
        v-if="!view.rows.length"
        :icon="ListOrdered"
        :title="filters.filtered.value ? 'Под фильтр заказов нет' : 'Заказов за месяц нет'"
        :description="
          filters.filtered.value
            ? 'Сбросьте фильтр или выберите другой месяц.'
            : 'Строки заказов загружаются по расписанию — загляните позже или выберите другой месяц.'
        "
      >
        <Button v-if="filters.filtered.value" variant="outline" @click="filters.resetFilter()">
          Сбросить фильтр
        </Button>
      </EmptyState>
      <AccountingOrdersTable
        v-else
        :rows="view.rows"
        :show-marketplace="view.marketplaceOptions.length > 1"
        @open="openOrder"
      />
    </template>

    <AccountingOrderCard />
  </section>
</template>
