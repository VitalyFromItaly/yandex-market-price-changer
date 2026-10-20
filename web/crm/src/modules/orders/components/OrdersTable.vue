<script setup lang="ts">
/**
 * Заказы отчёта: поиск, сортировка по клику на заголовок, показ порциями.
 * Строка — заказ или возврат целиком (решение владельца 2026-09-24);
 * разбивка по позициям — в xlsx.
 */
import type { OrderRow, SortKey } from '../orders.domain';

import { Search, X } from 'lucide-vue-next';
import { toRef } from 'vue';

import { PAGE_ROWS, useOrdersTable } from '../composables/useOrdersTable.orders';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
} from '@/components/ui/table';
import { formatCount, formatRub } from '@/shared/utils';

const props = withDefaults(
  defineProps<{
    rows: readonly OrderRow[];
    hasTypes: boolean;
    day?: string | null;
    dayLabel?: string | null;
  }>(),
  { day: null, dayLabel: null },
);
const emit = defineEmits<{ clearDay: [] }>();

const table = useOrdersTable(toRef(props, 'rows'), toRef(props, 'day'));

function sortProps(key: SortKey) {
  return {
    active: table.sort.value.key === key,
    direction: table.sort.value.dir,
    onSort: () => table.toggleSort(key),
  };
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-full max-w-sm">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          v-model="table.query.value"
          type="search"
          class="pl-9"
          placeholder="Номер заказа, товар или статус"
          aria-label="Поиск по заказам"
        />
      </div>
      <Button v-if="day !== null" variant="soft" size="sm" @click="emit('clearDay')">
        За {{ dayLabel }}
        <X aria-label="Показать все дни" />
      </Button>
    </div>

    <Card class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHead label="Заказ" v-bind="sortProps('orderId')" />
            <TableSortHead label="Дата" class="hidden md:table-cell" v-bind="sortProps('date')" />
            <TableHead v-if="hasTypes">Тип</TableHead>
            <TableSortHead
              label="Статус"
              class="hidden md:table-cell"
              v-bind="sortProps('status')"
            />
            <TableHead class="hidden lg:table-cell">Артикулы</TableHead>
            <TableSortHead label="Продажи" align="right" v-bind="sortProps('sales')" />
            <TableSortHead
              label="С доставкой"
              align="right"
              class="hidden sm:table-cell"
              v-bind="sortProps('withDelivery')"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in table.visible.value" :key="row.id">
            <TableCell class="tnum font-medium">{{ row.orderId ?? '—' }}</TableCell>
            <TableCell class="tnum hidden md:table-cell">{{ row.date || '—' }}</TableCell>
            <TableCell v-if="hasTypes">{{ row.typeLabel }}</TableCell>
            <TableCell class="hidden md:table-cell">{{ row.statusLabel || '—' }}</TableCell>
            <TableCell class="hidden max-w-sm truncate lg:table-cell" :title="row.items">
              {{ row.items || '—' }}
            </TableCell>
            <TableCell class="tnum text-right">
              {{ formatRub(row.sales) }}
              <span v-if="row.subsidies" class="block text-xs text-muted-foreground">
                субсидии {{ formatRub(row.subsidies) }}
              </span>
            </TableCell>
            <TableCell class="tnum hidden text-right sm:table-cell">
              {{ formatRub(row.withDelivery) }}
            </TableCell>
          </TableRow>
          <TableRow v-if="table.matched.value.length === 0">
            <TableCell colspan="7" class="py-8 text-center text-muted-foreground">
              {{
                day !== null && !table.query.value
                  ? 'В этот день строк нет.'
                  : 'Ничего не нашлось — попробуйте другой запрос.'
              }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <div v-if="table.hidden.value" class="flex items-center justify-center gap-3">
      <span class="tnum text-sm text-muted-foreground">
        Показано {{ formatCount(table.visible.value.length) }} из
        {{ formatCount(table.matched.value.length) }}
      </span>
      <Button variant="ghost" size="sm" @click="table.showMore">
        Показать ещё {{ Math.min(PAGE_ROWS, table.hidden.value) }}
      </Button>
    </div>
  </div>
</template>
