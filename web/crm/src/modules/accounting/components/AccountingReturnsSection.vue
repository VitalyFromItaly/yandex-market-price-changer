<script setup lang="ts">
/**
 * Возвраты «Финучёта» (TASK-225): возвращённые заказы месяца оформления магазина —
 * количество, доля, логистика, удержания, компенсации и итог по каждой площадке
 * колонкой рядом (площадки в одно число не складываются), частые модели и сами
 * заказы. Числа — с сервера (`returnResultOf`); фоновая задача, не GET.
 * Карточка заказа открывается, только если открыт раздел заказов (`canOpenOrder`).
 */
import type { AccountingReturnsOrderRow } from '../accounting.domain';

import { Info, Undo2 } from 'lucide-vue-next';
import { computed, onMounted, watch } from 'vue';

import { useAccountingOrdersFilters } from '../composables/useAccountingOrdersFilters.accounting';
import { useAccountingStore } from '../store/store.accounting';

import OrdersStorePicker from './OrdersStorePicker.vue';
import ReconcileMonthPicker from './ReconcileMonthPicker.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useStoresStore } from '@/modules/stores/store/store.stores';

const props = defineProps<{ canOpenOrder: boolean }>();

const store = useAccountingStore();
const stores = useStoresStore();
const storeOptions = computed(() =>
  (stores.stores ?? []).map((s) => ({ key: s.key, label: s.label })),
);
const filters = useAccountingOrdersFilters(() => storeOptions.value);
const { month } = filters;
const request = computed(() =>
  filters.store.value ? { store: filters.store.value.key, month: month.value } : null,
);

const view = computed(() => store.returns);

onMounted(() => void stores.loadList());
watch(
  request,
  (value) => {
    if (value) void store.loadReturns(value);
  },
  { immediate: true, deep: true },
);

function openOrder(row: AccountingReturnsOrderRow): void {
  const current = filters.store.value;
  if (!current || !props.canOpenOrder) return;
  void store.openOrder({ store: current.key, marketplace: row.marketplace, orderId: row.orderId });
}

const NUM = 'whitespace-nowrap text-right tabular-nums';
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-base font-semibold">Возвраты</h2>
        <p class="text-sm text-muted-foreground">
          Во что обошлись возвраты заказов месяца по журналу каждой площадки.
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

    <Alert v-if="stores.listError && !storeOptions.length">
      Не удалось загрузить магазины: {{ stores.listError }}
    </Alert>
    <EmptyState
      v-else-if="!stores.listLoading && stores.stores !== null && !storeOptions.length"
      :icon="Undo2"
      title="Нет магазинов"
      description="Подключите Яндекс Маркет в разделе «Подключения» — возвраты появятся после загрузки заказов."
    />

    <Alert v-else-if="store.returnsError && !view">
      {{ store.returnsError }}
      <Button variant="outline" size="sm" class="ml-2" @click="store.retryReturns()"
        >Повторить</Button
      >
    </Alert>

    <div v-else-if="!view" class="flex flex-col gap-3">
      <Skeleton class="h-72" />
      <Skeleton class="h-40" />
    </div>

    <template v-else>
      <RefreshIndicator
        :refreshing="store.returnsRefreshing"
        :saved-at="store.returnsSavedAt"
        :error="store.returnsError"
        @retry="store.retryReturns()"
      />

      <EmptyState
        v-if="!view.hasReturns"
        :icon="Undo2"
        title="Возвратов за месяц нет"
        :description="`Заказы, оформленные в ${view.periodLabel.toLowerCase()}, не возвращались. Выберите другой месяц, если ищете возврат.`"
      />

      <template v-else>
        <Card class="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{{ view.periodLabel }}</TableHead>
                <TableHead v-for="column in view.columns" :key="column.marketplace" :class="NUM">
                  {{ column.label }}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="metric in view.metrics" :key="metric.key">
                <TableCell :class="{ 'font-medium': metric.total }">
                  <span class="inline-flex items-center gap-1.5">
                    {{ metric.title }}
                    <Tooltip v-if="metric.hint" :text="metric.hint">
                      <button
                        type="button"
                        class="text-muted-foreground"
                        :aria-label="`Что входит: ${metric.title}`"
                      >
                        <Info class="size-3.5" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </span>
                </TableCell>
                <TableCell
                  v-for="(cell, index) in metric.cells"
                  :key="view.columns[index]?.marketplace"
                  :class="[NUM, { 'font-medium': metric.total }]"
                >
                  {{ cell }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="flex flex-col gap-2">
            <h3 class="text-sm font-semibold">Чаще всего возвращают</h3>
            <Card class="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Товар</TableHead>
                    <TableHead :class="NUM">Вернули</TableHead>
                    <TableHead :class="NUM">Доля</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="model in view.models" :key="model.key">
                    <TableCell class="max-w-64">
                      <div class="truncate">{{ model.name }}</div>
                      <div class="truncate text-xs text-muted-foreground">
                        {{ model.offerId
                        }}<template v-if="view.columns.length > 1">
                          · {{ model.marketplaceLabel }}</template
                        >
                      </div>
                    </TableCell>
                    <TableCell :class="NUM">{{ model.returnedLabel }}</TableCell>
                    <TableCell :class="NUM">{{ model.rateLabel }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          </div>

          <div class="flex flex-col gap-2">
            <h3 class="text-sm font-semibold">Возвращённые заказы</h3>
            <Card class="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Заказ</TableHead>
                    <TableHead :class="['hidden md:table-cell', NUM]">Логистика</TableHead>
                    <TableHead :class="NUM">Итог</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="row in view.orders" :key="row.key">
                    <TableCell class="max-w-64">
                      <Button
                        v-if="canOpenOrder"
                        variant="link"
                        size="sm"
                        class="h-auto p-0 font-medium"
                        @click="openOrder(row)"
                      >
                        {{ row.orderId }}
                      </Button>
                      <span v-else class="font-medium">{{ row.orderId }}</span>
                      <div class="truncate text-xs text-muted-foreground">
                        {{ row.dayLabel
                        }}<template v-if="view.columns.length > 1">
                          · {{ row.marketplaceLabel }}</template
                        >
                        · {{ row.title }}
                      </div>
                    </TableCell>
                    <TableCell :class="['hidden md:table-cell', NUM]">
                      {{ row.logisticsLabel }}
                    </TableCell>
                    <TableCell :class="[NUM, 'font-medium', { 'text-danger': row.isLoss }]">
                      {{ row.resultLabel }}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>
