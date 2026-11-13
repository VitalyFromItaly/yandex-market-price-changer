<script setup lang="ts">
/**
 * Карточка заказа «Финучёта» (TASK-223, API — TASK-222): состояние прибыли,
 * подтверждённое и ожидаемое раздельно, суммы по ТЗ п.4 с раскрытием до
 * операций, справочное и версии снимка. Неокончательная не выглядит окончательной.
 */
import { computed } from 'vue';

import { ACCOUNTING_LOTS_FEATURE } from '../accounting.domain';
import { useAccountingStore } from '../store/store.accounting';

import OrderAmountsTable from './OrderAmountsTable.vue';
import OrderOperationsTable from './OrderOperationsTable.vue';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { KpiCard } from '@/components/ui/kpi-card';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';

const store = useAccountingStore();
const auth = useAuthStore();
// Метод себестоимости виден, когда есть из чего выбирать — под `fin_accounting_lots`.
const lotsOpen = computed(() => auth.me?.features[ACCOUNTING_LOTS_FEATURE] === true);
const card = computed(() => store.orderCard);
const open = computed({
  get: () => store.orderRequest !== null,
  set: (value: boolean) => {
    if (!value) store.closeOrder();
  },
});
const title = computed(
  () => card.value?.title ?? `Заказ ${store.orderRequest?.orderId ?? ''}`.trim(),
);
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ card?.subtitle ?? 'Карточка собирается…' }}</DialogDescription>
      </DialogHeader>

      <Alert v-if="store.orderError && !card">
        {{ store.orderError }}
        <Button variant="outline" size="sm" class="ml-2" @click="store.retryOrder()">
          Повторить
        </Button>
      </Alert>

      <div v-else-if="!card" class="flex flex-col gap-3">
        <Skeleton class="h-8" />
        <Skeleton class="h-24" />
        <Skeleton class="h-64" />
      </div>

      <div v-else class="flex min-w-0 flex-col gap-4">
        <RefreshIndicator
          :refreshing="store.orderRefreshing"
          :saved-at="store.orderSavedAt"
          :error="store.orderError"
          @retry="store.retryOrder()"
        />
        <div class="flex flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <Badge :variant="card.stateTone">{{ card.stateLabel }}</Badge>
            <span v-if="card.provisionalNote" class="text-sm text-warn">
              {{ card.provisionalNote }}
            </span>
          </div>
          <p class="text-sm text-muted-foreground">{{ card.stateHint }}</p>
          <p v-if="lotsOpen" class="text-sm text-muted-foreground">{{ card.cogsMethodLabel }}</p>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
          <KpiCard label="Подтверждено" :value="card.confirmedLabel" />
          <KpiCard label="Ожидается" :value="card.expectedLabel" />
          <KpiCard
            :label="card.provisionalNote ? 'Чистая прибыль (предварительно)' : 'Чистая прибыль'"
            :value="card.netLabel"
            :caption="card.unknownNote"
            :tone="card.isLoss ? 'danger' : 'neutral'"
          />
        </div>

        <OrderAmountsTable :rows="card.amounts" />

        <section v-if="card.reference.length" class="flex flex-col gap-1">
          <h3 class="text-sm font-semibold">Справочно, вне суммы</h3>
          <OrderOperationsTable :operations="card.reference" :cost-lines="[]" />
        </section>

        <section class="flex flex-col gap-1">
          <h3 class="text-sm font-semibold">Цены заказа</h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div v-for="price in card.prices" :key="price.label">
              <dt class="text-xs text-muted-foreground">{{ price.label }}</dt>
              <dd class="tabular-nums">{{ price.value }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="card.versions.length" class="flex flex-col gap-1">
          <h3 class="text-sm font-semibold">История прибыли</h3>
          <p
            v-for="version in card.versions"
            :key="version.key"
            class="flex flex-wrap gap-x-3 text-sm text-muted-foreground"
          >
            <span class="text-foreground">{{ version.label }}</span>
            <span>{{ version.stateLabel }}</span>
            <span class="tabular-nums">{{ version.netLabel }}</span>
            <span class="tabular-nums">{{ version.atLabel }}</span>
          </p>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
