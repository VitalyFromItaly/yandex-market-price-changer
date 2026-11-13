<script setup lang="ts">
/**
 * Раскрытие строки панели (TASK-231): из каких операций реестра, сумм карточек
 * заказов и записей продавца сложилась ячейка итогов. Номер заказа ведёт в карточку,
 * только если открыт раздел заказов (`canOpenOrder`).
 */
import type { DashboardDrillOrderRow } from '../accounting.domain';

import { computed } from 'vue';

import { useAccountingStore } from '../store/store.accounting';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

const props = defineProps<{ canOpenOrder: boolean }>();

const store = useAccountingStore();
const view = computed(() => store.drill);
const open = computed({
  get: () => store.drillRequest !== null,
  set: (value: boolean) => {
    if (!value) store.closeDrill();
  },
});

function openOrder(row: DashboardDrillOrderRow): void {
  const request = store.drillRequest;
  if (!request || !props.canOpenOrder) return;
  store.closeDrill();
  void store.openOrder({
    store: request.store,
    marketplace: row.marketplace,
    orderId: row.orderId,
  });
}

const NUM = 'whitespace-nowrap text-right tabular-nums';
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          {{ view?.title ?? 'Раскрытие строки' }}
          <span v-if="view" class="ml-2 tabular-nums">{{ view.totalLabel }}</span>
        </DialogTitle>
        <DialogDescription>{{ view?.subtitle ?? 'Собираем операции…' }}</DialogDescription>
      </DialogHeader>

      <Alert v-if="store.drillError && !view">
        {{ store.drillError }}
        <Button variant="outline" size="sm" class="ml-2" @click="store.retryDrill()">
          Повторить
        </Button>
      </Alert>

      <div v-else-if="!view" class="flex flex-col gap-3">
        <Skeleton class="h-40" />
        <Skeleton class="h-24" />
      </div>

      <div v-else class="flex flex-col gap-4">
        <RefreshIndicator
          :refreshing="store.drillRefreshing"
          :saved-at="store.drillSavedAt"
          :error="store.drillError"
          @retry="store.retryDrill()"
        />

        <p v-if="view.isEmpty" class="text-sm text-muted-foreground">
          В этой строке за период ничего нет.
        </p>

        <div v-if="view.operations.length" class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold">Операции</h3>
          <Card class="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Операция</TableHead>
                  <TableHead class="hidden sm:table-cell">Начислена</TableHead>
                  <TableHead :class="NUM">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in view.operations" :key="row.key">
                  <TableCell class="max-w-72">
                    <div class="truncate">
                      {{ row.title }}
                      <Badge v-if="row.manual" variant="outline" class="ml-1">Ручная</Badge>
                    </div>
                    <div class="truncate text-xs text-muted-foreground">
                      {{ row.marketplaceLabel
                      }}<template v-if="row.documentLabel">
                        · документ {{ row.documentLabel }}</template
                      >
                      <span class="sm:hidden"> · {{ row.dayLabel }}</span>
                    </div>
                  </TableCell>
                  <TableCell class="hidden sm:table-cell">{{ row.dayLabel }}</TableCell>
                  <TableCell :class="NUM">{{ row.amountLabel }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
          <p v-if="view.operationsNote" class="text-xs text-muted-foreground">
            {{ view.operationsNote }}
          </p>
        </div>

        <div v-if="view.orders.length" class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold">Суммы заказов</h3>
          <p class="text-xs text-muted-foreground">
            Себестоимость, распределённые расходы и ожидаемые суммы — своих операций у них нет.
          </p>
          <Card class="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Заказ</TableHead>
                  <TableHead :class="NUM">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in view.orders" :key="row.key">
                  <TableCell class="max-w-72">
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
                      {{ row.title }}<template v-if="row.note"> · {{ row.note }}</template>
                    </div>
                  </TableCell>
                  <TableCell :class="[NUM, { 'text-warn': row.expected }]">
                    {{ row.amountLabel }}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
          <p v-if="view.ordersNote" class="text-xs text-muted-foreground">
            {{ view.ordersNote }}
          </p>
        </div>

        <div v-if="view.records.length" class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold">Записи продавца</h3>
          <Card class="p-0">
            <Table>
              <TableBody>
                <TableRow v-for="row in view.records" :key="row.key">
                  <TableCell class="max-w-72">
                    <div class="truncate">{{ row.title }}</div>
                    <div class="text-xs text-muted-foreground">{{ row.sourceLabel }}</div>
                  </TableCell>
                  <TableCell :class="NUM">{{ row.amountLabel }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
