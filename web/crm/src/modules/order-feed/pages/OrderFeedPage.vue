<script setup lang="ts">
/**
 * «Лента заказов» (TASK-144, ТЗ п.11): заказы площадки экрана — этап из 10,
 * прибыль заказа по журналу, расходы по статьям и история операций. Только
 * чтение. Площадка — из адреса (/ozon/order-feed, TASK-182): у каждой свой
 * экран, в один список площадки не смешиваются.
 */
import type { OrderStage } from '../order-feed.domain';

import { ReceiptText, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import OrderDetailDialog from '../components/OrderDetailDialog.vue';
import OrderFeedTable from '../components/OrderFeedTable.vue';
import { useOrderFeedFilters } from '../composables/useOrderFeedFilters.order-feed';
import { filterRows, stageOptions, totalsLines } from '../mappers/orderFeedTable.order-feed';
import { DEEP_HISTORY_FEATURE, FINANCE_FEATURE } from '../order-feed.domain';
import { useOrderFeedStore } from '../store/store.order-feed';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useMarketplace } from '@/shared/composables';
import { JournalPull, rangeOfReportPeriod, useFinanceJournal } from '@/shared/finance-journal';
import { PeriodPicker, moscowTodayIso } from '@/shared/period';

const store = useOrderFeedStore();
const auth = useAuthStore();
const { period, data, isLoading, isRefreshing, savedAt, error } = storeToRefs(store);
const { opened, detail, detailLoading, detailError } = storeToRefs(store);
const { filters, update } = useOrderFeedFilters();
const routeMarketplace = useMarketplace();
const marketplace = computed(() => routeMarketplace.value ?? 'ym');
store.selectMarketplace(marketplace.value);

// Прибыль заказа — из журнала: не загружен — «Загрузить из Маркета», а не пустая колонка.
const journal = useFinanceJournal(
  () => ({
    marketplace: marketplace.value,
    ...rangeOfReportPeriod(period.value, moscowTodayIso()),
  }),
  () => store.retry(),
);

const ready = computed(() => auth.me !== null);
const withFinance = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);
const unlimited = computed(() => auth.me?.features?.[DEEP_HISTORY_FEATURE] === true);

const rows = computed(() => (data.value ? filterRows(data.value.rows, filters.value) : []));
const stOptions = computed(() => (data.value ? stageOptions(data.value.stages) : []));
const totals = computed(() => (data.value ? totalsLines(data.value.totals) : []));

function onStage(value: OrderStage | 'all'): void {
  update({ stage: value === 'all' ? null : value });
}
function onProduct(value: string | number | undefined): void {
  update({ product: value === undefined ? '' : String(value) });
}

watch(
  () => (ready.value && withFinance.value ? marketplace.value : null),
  (mp) => {
    if (mp === null) return;
    store.selectMarketplace(mp);
    store.ensure();
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader
    title="Лента заказов"
    description="Заказы площадки: этап, прибыль по операциям журнала, расходы и история"
  >
    <template #actions>
      <PeriodPicker
        :model-value="period"
        :unlimited="unlimited"
        :disabled="!withFinance"
        @update:model-value="store.selectPeriod"
      />
      <Button variant="outline" :disabled="isLoading || !withFinance" @click="store.refresh()">
        <RotateCw />
        Обновить
      </Button>
    </template>
  </PageHeader>

  <Alert v-if="ready && !withFinance">
    Прибыль заказа считается по финансовому журналу — откройте «Финансы» у администратора.
  </Alert>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">
      Собираю заказы площадки и операции журнала — это может занять несколько минут…
    </p>
    <Skeleton class="h-10 w-full" />
    <Skeleton class="h-96 w-full" />
  </div>

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.refresh()"
    />

    <p class="text-sm text-muted-foreground">Заказы, оформленные {{ data.periodTitle }}.</p>

    <JournalPull :journal="journal" />
    <ul v-if="totals.length" class="flex flex-col gap-1 text-sm">
      <li v-for="line in totals" :key="line" class="tabular-nums">{{ line }}</li>
    </ul>

    <Alert
      v-for="problem in data.problems"
      :key="`${problem.marketplace}:${problem.storeName}:${problem.problem}`"
    >
      <template v-if="problem.storeName">«{{ problem.storeName }}»: </template>{{ problem.problem }}
    </Alert>

    <div class="flex flex-col gap-3">
      <OptionGroup
        label="Этап"
        :model-value="filters.stage ?? 'all'"
        :options="stOptions"
        @update:model-value="onStage"
      />
      <Input
        class="max-w-sm"
        placeholder="Товар: артикул или название"
        aria-label="Поиск товара"
        :model-value="filters.product"
        @update:model-value="onProduct"
      />
    </div>

    <EmptyState
      v-if="rows.length === 0"
      :icon="ReceiptText"
      title="Заказов нет"
      :description="
        data.rows.length
          ? 'Под фильтры ничего не подошло — снимите часть фильтров.'
          : 'За этот период площадка заказов не дала — или не ответила (причины выше).'
      "
    />
    <OrderFeedTable v-else :rows="rows" @open="store.openOrder" />

    <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
      <li>
        Прибыль заказа — сумма его операций в финансовом журнале минус себестоимость. Пока операций
        нет, прибыли нет — это не ноль.
      </li>
      <li v-for="note in data.notes" :key="note">{{ note }}</li>
    </ul>
  </div>

  <OrderDetailDialog
    :row="opened"
    :detail="detail"
    :loading="detailLoading"
    :error="detailError"
    @close="store.closeOrder()"
  />
</template>
