<script setup lang="ts">
/**
 * Товары склада: свой склад, по площадке FBS и её склад (FBY/FBO/FBW) отдельными
 * колонками — без суммы, в пути, возвраты, скорость, дни запаса и стоимость.
 * Поиск, фильтр, сортировка по клику, показ порциями. Заканчивающиеся — сверху.
 */
import type { InventoryColumn, InventoryRow, InventorySortKey } from '../inventory.domain';

import { Search } from 'lucide-vue-next';
import { toRef } from 'vue';

import { PAGE_ROWS, useInventoryTable } from '../composables/useInventoryTable.inventory';
import { INVENTORY_FILTERS } from '../inventory.domain';
import { amountLabel, countLabel, isLow, speedLabel } from '../mappers/inventoryTable.inventory';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
} from '@/components/ui/table';
import { formatCount, formatKopecks } from '@/shared/utils';

const props = defineProps<{
  rows: readonly InventoryRow[];
  columns: readonly InventoryColumn[];
  lowDays: number;
  basisDays: number;
}>();

const table = useInventoryTable(toRef(props, 'rows'), toRef(props, 'lowDays'));

function sortProps(key: InventorySortKey) {
  return {
    active: table.sort.value.key === key,
    direction: table.sort.value.dir,
    onSort: () => table.toggleSort(key),
  };
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative w-full max-w-sm">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          v-model="table.query.value"
          type="search"
          class="pl-9"
          placeholder="Артикул или название"
          aria-label="Поиск по артикулу или названию"
        />
      </div>
      <OptionGroup v-model="table.filter.value" :options="INVENTORY_FILTERS" label="Какие товары" />
    </div>

    <Card class="overflow-x-auto p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHead label="Товар" v-bind="sortProps('name')" />
            <TableSortHead label="Свой склад" align="right" v-bind="sortProps('ownStock')" />
            <template v-for="column in columns" :key="column.marketplace">
              <TableHead class="hidden text-right lg:table-cell">
                {{ column.label }} · {{ column.places.seller }}
              </TableHead>
              <TableHead class="hidden text-right md:table-cell">
                {{ column.places.marketplace }}
              </TableHead>
            </template>
            <TableSortHead
              label="В пути"
              align="right"
              class="hidden sm:table-cell"
              v-bind="sortProps('inTransit')"
            />
            <TableHead class="hidden text-right sm:table-cell">Возвраты</TableHead>
            <TableSortHead
              :label="`Шт./день (${basisDays} дн.)`"
              align="right"
              class="hidden md:table-cell"
              v-bind="sortProps('unitsPerDay')"
            />
            <TableSortHead label="Дней запаса" align="right" v-bind="sortProps('daysLeft')" />
            <TableSortHead
              label="Стоимость"
              align="right"
              class="hidden md:table-cell"
              v-bind="sortProps('valueKopecks')"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in table.visible.value" :key="row.productId">
            <TableCell class="max-w-64">
              <div class="truncate font-medium" :title="row.name ?? row.internalSku">
                {{ row.name ?? row.internalSku }}
              </div>
              <div class="truncate text-xs text-muted-foreground">{{ row.internalSku }}</div>
            </TableCell>
            <TableCell class="tnum text-right">{{ countLabel(row.ownStock) }}</TableCell>
            <template v-for="column in columns" :key="column.marketplace">
              <TableCell class="tnum hidden text-right text-muted-foreground lg:table-cell">
                {{ amountLabel(row.byMarketplace[column.marketplace]?.seller) }}
              </TableCell>
              <TableCell class="tnum hidden text-right md:table-cell">
                {{ amountLabel(row.byMarketplace[column.marketplace]?.marketplace) }}
              </TableCell>
            </template>
            <TableCell class="tnum hidden text-right sm:table-cell">
              {{ countLabel(row.inTransit) }}
            </TableCell>
            <TableCell class="tnum hidden text-right sm:table-cell">
              {{ countLabel(row.returning) }}
            </TableCell>
            <TableCell class="tnum hidden text-right md:table-cell">
              {{ speedLabel(row.unitsPerDay) }}
            </TableCell>
            <TableCell class="tnum text-right">
              <span
                v-if="row.daysLeft === null"
                class="text-muted-foreground"
                title="Нет продаж за окно"
              >
                —
              </span>
              <Badge v-else-if="isLow(row, lowDays)" variant="warn">{{
                formatCount(row.daysLeft)
              }}</Badge>
              <span v-else>{{ formatCount(row.daysLeft) }}</span>
            </TableCell>
            <TableCell class="tnum hidden text-right md:table-cell">
              <span
                v-if="row.valueKopecks === null"
                class="text-muted-foreground"
                title="Закупа нет"
              >
                нет закупа
              </span>
              <span v-else>{{ formatKopecks(row.valueKopecks) }}</span>
            </TableCell>
          </TableRow>
          <TableRow v-if="table.matched.value.length === 0">
            <TableCell
              :colspan="7 + columns.length * 2"
              class="py-8 text-center text-muted-foreground"
            >
              Ничего не нашлось — измените запрос или фильтр.
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
