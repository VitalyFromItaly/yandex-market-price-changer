<script setup lang="ts">
/**
 * История закупа v2 «Финучёта» (TASK-235) под зонтиком `fin_accounting`: найти товар,
 * увидеть записи закупа с моментом начала действия, источником и автором, исправить
 * прошлую цену с причиной и прочитать журнал правок. Продажа берёт последнюю запись
 * до своего момента — это правило сервера, здесь только показ. Текущая история
 * себестоимости «Товаров» — другая и здесь не видна.
 */
import { History, Search } from 'lucide-vue-next';
import { computed } from 'vue';

import { useCostCorrectionDialog } from '../composables/useCostCorrectionDialog.accounting';
import { useCostProductSearch } from '../composables/useCostProductSearch.accounting';
import { toCostChangeRows, toCostRecordRows } from '../mappers/mapCostHistory.accounting';
import { useAccountingStore } from '../store/store.accounting';

import CostCorrectionDialog from './CostCorrectionDialog.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuthStore } from '@/modules/auth/store/store.auth';

const store = useAccountingStore();
const auth = useAuthStore();
const me = computed(() => auth.me?.telegramUserId);

const search = useCostProductSearch();
const dialog = useCostCorrectionDialog();

const productLabel = computed(() => {
  const product = store.costProduct;
  if (product === null) return '';
  return product.name ? `${product.name} · ${product.internalSku}` : product.internalSku;
});
const records = computed(() =>
  store.costHistory ? toCostRecordRows(store.costHistory.records, me.value) : [],
);
const changes = computed(() =>
  store.costHistory ? toCostChangeRows(store.costHistory.changes, me.value) : [],
);

function correct(id: string | null): void {
  const record =
    id === null ? null : (store.costHistory?.records.find((item) => item.id === id) ?? null);
  dialog.openFor(record);
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <div>
      <h2 class="text-base font-semibold">История закупа</h2>
      <p class="text-sm text-muted-foreground">
        Закуп действует с момента записи до следующей. Продажа берёт последнюю запись до своего
        момента; записи нет — закупка неизвестна. Прошлую цену можно исправить с причиной.
      </p>
    </div>

    <Card class="flex flex-col gap-3 p-4">
      <FormField id="cost-product-search" v-slot="{ attrs }" label="Товар">
        <Input
          v-bind="attrs"
          v-model="search.query.value"
          type="search"
          placeholder="Артикул или название"
          autocomplete="off"
        />
      </FormField>

      <Alert v-if="search.error.value">{{ search.error.value }}</Alert>
      <Skeleton v-else-if="search.searching.value" class="h-16" />
      <p
        v-else-if="search.searched.value && !search.found.value.length"
        class="text-sm text-muted-foreground"
      >
        Ничего не нашлось. Проверьте артикул или название.
      </p>
      <ul v-else-if="search.found.value.length" class="flex flex-col divide-y rounded-md border">
        <li v-for="product in search.found.value" :key="product.id">
          <button
            type="button"
            class="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            @click="search.pick(product)"
          >
            <span class="text-sm font-medium">{{ product.name ?? product.internalSku }}</span>
            <span class="text-xs text-muted-foreground">{{ product.internalSku }}</span>
          </button>
        </li>
        <li v-if="search.more.value" class="px-3 py-2 text-xs text-muted-foreground">
          Показаны первые {{ search.found.value.length }} — уточните запрос.
        </li>
      </ul>
    </Card>

    <EmptyState
      v-if="!store.costProduct"
      :icon="Search"
      title="Выберите товар"
      description="Найдите товар по артикулу или названию — здесь появятся его записи закупа."
    />

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">{{ productLabel }}</h3>
        <Button
          size="sm"
          variant="outline"
          :disabled="store.costHistoryLoading || dialog.busy.value"
          @click="correct(null)"
        >
          Исправить прошлую цену
        </Button>
      </div>

      <Alert v-if="store.costHistoryError">
        История закупа не загрузилась: {{ store.costHistoryError }}
      </Alert>
      <Skeleton v-else-if="!store.costHistory" class="h-32" />
      <EmptyState
        v-else-if="!records.length"
        :icon="History"
        title="Записей закупа нет"
        description="Запись появится после загрузки прайса. Можно задать прошлую цену вручную."
      />
      <Card v-else class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Действует с</TableHead>
              <TableHead>Закуп</TableHead>
              <TableHead>Источник</TableHead>
              <TableHead>Кто</TableHead>
              <TableHead class="w-0"><span class="sr-only">Действия</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in records" :key="row.id">
              <TableCell class="whitespace-nowrap tabular-nums">{{ row.momentLabel }}</TableCell>
              <TableCell class="tabular-nums">{{ row.purchaseLabel }}</TableCell>
              <TableCell>{{ row.sourceLabel }}</TableCell>
              <TableCell>{{ row.authorLabel }}</TableCell>
              <TableCell class="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  :disabled="dialog.busy.value"
                  @click="correct(row.id)"
                >
                  Исправить
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <div v-if="changes.length" class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold">Журнал исправлений</h3>
        <ol class="flex flex-col gap-3">
          <li v-for="item in changes" :key="item.id" class="flex flex-col gap-1">
            <div class="text-sm">
              <span class="font-medium">{{ item.actionLabel }}</span>
              <span class="text-muted-foreground">
                · {{ item.createdLabel }} · {{ item.authorLabel }}</span
              >
            </div>
            <div class="text-xs text-muted-foreground">
              <template v-if="item.beforeLabel">Было: {{ item.beforeLabel }}. </template>
              Стало: {{ item.afterLabel }}
            </div>
            <div class="text-xs">Причина: {{ item.reason }}</div>
          </li>
        </ol>
      </div>
    </template>

    <CostCorrectionDialog
      v-model:open="dialog.open.value"
      v-model:form="dialog.form.value"
      :product-label="productLabel"
      :currencies="store.costCurrencies"
      :errors="dialog.errors.value"
      :busy="dialog.busy.value"
      @save="dialog.save"
    />
  </section>
</template>
