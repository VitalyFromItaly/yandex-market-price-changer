<script setup lang="ts">
/**
 * Панель «Финучёта» (TASK-231, API — TASK-229/230): итоги по строкам и площадкам в
 * выбранном базисе (продажа / начисление / деньги), фильтры площадки, бренда, артикула
 * и заказа, раскрытие ячейки до операций, свежесть журнала и аналитика заказов периода.
 * Числа — только с сервера; «Все площадки» — только если её собрал сервер.
 */
import type { AnalyticsLossOrderRow, DashboardCell } from '../accounting.domain';

import { Check, ChevronDown, LayoutDashboard } from 'lucide-vue-next';
import { computed, onMounted, watch } from 'vue';

import { useAccountingDashboardFilters } from '../composables/useAccountingDashboardFilters.accounting';
import { ALL_OPTION } from '../composables/useAccountingOrdersFilters.accounting';
import { useAccountingStore } from '../store/store.accounting';

import AccountingAnalyticsBlock from './AccountingAnalyticsBlock.vue';
import DashboardDrillDialog from './DashboardDrillDialog.vue';
import DashboardTotalsTable from './DashboardTotalsTable.vue';
import OrdersStorePicker from './OrdersStorePicker.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoresStore } from '@/modules/stores/store/store.stores';
import { RangePicker } from '@/shared/period';

const props = defineProps<{ canOpenOrder: boolean }>();

const store = useAccountingStore();
const stores = useStoresStore();
const storeOptions = computed(() =>
  (stores.stores ?? []).map((s) => ({ key: s.key, label: s.label })),
);
const filters = useAccountingDashboardFilters(() => storeOptions.value);
const { basis, marketplace, brand, offerDraft, orderDraft } = filters;

const view = computed(() => store.dashboard);
const analytics = computed(() => store.analytics);

/** Базисы — подписи из ответа; до первого ответа — те же подписи, что у сервера. */
const BASIS_FALLBACK = [
  { value: 'sale', label: 'По дате продажи' },
  { value: 'accrual', label: 'По дате начисления' },
  { value: 'cash', label: 'По движению денег' },
] as const;
const basisOptions = computed(() => view.value?.basisOptions ?? BASIS_FALLBACK);
const marketplaceOptions = computed(() => [
  { value: ALL_OPTION, label: 'Все площадки' },
  ...(view.value?.marketplaceOptions ?? []),
]);
const brandLabel = computed(
  () =>
    view.value?.brandOptions.find((o) => o.key === brand.value)?.label ??
    (brand.value ? brand.value : 'Все бренды'),
);

onMounted(() => void stores.loadList());
watch(
  filters.dashboardRequest,
  (value) => {
    if (value) void store.loadDashboard(value);
  },
  { immediate: true, deep: true },
);
watch(
  filters.analyticsRequest,
  (value) => {
    if (value) void store.loadAnalytics(value);
  },
  { immediate: true, deep: true },
);

function drill(cell: DashboardCell): void {
  const request = filters.dashboardRequest.value;
  if (!request || !cell.line) return;
  void store.openDrill({ ...request, line: cell.line, block: cell.block });
}

function openOrder(row: AnalyticsLossOrderRow): void {
  const current = filters.store.value;
  if (!current || !props.canOpenOrder) return;
  void store.openOrder({ store: current.key, marketplace: row.marketplace, orderId: row.orderId });
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-base font-semibold">Панель</h2>
        <p class="text-sm text-muted-foreground">
          Итоги учёта по журналу площадок: выручка, расходы и прибыль за период.
        </p>
      </div>
      <OrdersStorePicker
        v-if="storeOptions.length > 1"
        :options="storeOptions"
        :selected="filters.store.value?.key ?? null"
        :label="filters.store.value?.label ?? 'Магазин'"
        @select="filters.selectStore"
      />
    </div>

    <div class="flex flex-col gap-2">
      <OptionGroup v-model="basis" :options="basisOptions" label="Базис периода" />
      <RangePicker
        :preset="filters.preset.value"
        :custom="filters.custom.value"
        @preset="filters.choosePreset"
        @custom="filters.chooseCustom"
      />
      <div class="flex flex-wrap items-center gap-2">
        <OptionGroup
          v-if="marketplaceOptions.length > 2"
          v-model="marketplace"
          :options="marketplaceOptions"
          label="Площадка"
        />
        <DropdownMenu v-if="view?.brandOptions.length">
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="sm" aria-label="Бренд">
              <span class="max-w-40 truncate">{{ brandLabel }}</span>
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="max-h-80 overflow-y-auto">
            <DropdownMenuItem @select="brand = ALL_OPTION">
              <Check :class="brand ? 'invisible' : ''" aria-hidden="true" />
              Все бренды
            </DropdownMenuItem>
            <DropdownMenuItem
              v-for="option in view.brandOptions"
              :key="option.key"
              @select="brand = option.key"
            >
              <Check :class="brand === option.key ? '' : 'invisible'" aria-hidden="true" />
              {{ option.label }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <form class="flex flex-wrap items-center gap-2" @submit.prevent="filters.applyRefs()">
          <Input
            v-model="offerDraft"
            class="h-8 w-40"
            maxlength="100"
            placeholder="Артикул"
            aria-label="Артикул продавца"
          />
          <Input
            v-model="orderDraft"
            class="h-8 w-40"
            maxlength="100"
            placeholder="Номер заказа"
            aria-label="Номер заказа"
          />
          <Button type="submit" variant="outline" size="sm">Применить</Button>
        </form>
        <Button
          v-if="filters.filtered.value"
          variant="ghost"
          size="sm"
          @click="filters.resetFilter()"
        >
          Сбросить фильтр
        </Button>
      </div>
    </div>

    <Alert v-if="stores.listError && !storeOptions.length">
      Не удалось загрузить магазины: {{ stores.listError }}
    </Alert>
    <EmptyState
      v-else-if="!stores.listLoading && stores.stores !== null && !storeOptions.length"
      :icon="LayoutDashboard"
      title="Нет магазинов"
      description="Подключите Яндекс Маркет в разделе «Подключения» — итоги появятся после загрузки журнала."
    />

    <Alert v-else-if="store.dashboardError && !view">
      {{ store.dashboardError }}
      <Button variant="outline" size="sm" class="ml-2" @click="store.retryDashboard()">
        Повторить
      </Button>
    </Alert>

    <div v-else-if="!view" class="flex flex-col gap-3">
      <Skeleton class="h-96" />
      <Skeleton class="h-40" />
    </div>

    <template v-else>
      <RefreshIndicator
        :refreshing="store.dashboardRefreshing"
        :saved-at="store.dashboardSavedAt"
        :error="store.dashboardError"
        @retry="store.retryDashboard()"
      />

      <div class="flex flex-col gap-1 text-sm">
        <p>
          <span class="font-medium">{{ view.basisTitle }}.</span>
          <span class="text-muted-foreground"> {{ view.basisHint }}</span>
        </p>
        <p class="text-muted-foreground">
          {{ view.freshnessLabel
          }}<template v-if="view.freshness.length > 1"
            >:
            <template v-for="(f, index) in view.freshness" :key="f.marketplace"
              >{{ index ? ', ' : '' }}{{ f.label }} — {{ f.text }}</template
            ></template
          >
        </p>
      </div>

      <Alert v-if="view.filterNote" variant="warn">{{ view.filterNote }}</Alert>

      <EmptyState
        v-if="!view.columns.length"
        :icon="LayoutDashboard"
        title="Площадок нет"
        description="Подключите площадку в разделе «Подключения» — журнал начнёт загружаться по расписанию."
      />
      <template v-else>
        <DashboardTotalsTable :view="view" @drill="drill" />
        <p class="text-xs text-muted-foreground">
          Нажмите на сумму, чтобы увидеть операции.<template v-if="view.hasEstimate">
            * — оценка: в сумме есть ожидаемые, ещё не начисленные площадкой.</template
          ><template v-if="view.hasUnknown">
            «Неизвестно» — хотя бы одна сумма не определена (например, нет себестоимости), итог не
            считается.</template
          >
        </p>
      </template>
    </template>

    <Alert v-if="store.analyticsError && !analytics">
      {{ store.analyticsError }}
      <Button variant="outline" size="sm" class="ml-2" @click="store.retryAnalytics()">
        Повторить
      </Button>
    </Alert>
    <Skeleton v-else-if="!analytics && filters.analyticsRequest.value" class="h-72" />
    <template v-else-if="analytics">
      <RefreshIndicator
        :refreshing="store.analyticsRefreshing"
        :saved-at="store.analyticsSavedAt"
        :error="store.analyticsError"
        @retry="store.retryAnalytics()"
      />
      <AccountingAnalyticsBlock
        :view="analytics"
        :can-open-order="canOpenOrder"
        @order="openOrder"
      />
    </template>

    <DashboardDrillDialog :can-open-order="canOpenOrder" />
  </section>
</template>
