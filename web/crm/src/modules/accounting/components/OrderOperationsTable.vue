<script setup lang="ts">
/**
 * Раскрытие строки карточки заказа (TASK-223): операции, из которых сложена
 * сумма (услуга, сумма, день, id, площадка, документ), у себестоимости — позиции
 * с закупом единицы.
 */
import type { OrderCostLineRow, OrderOperationRow } from '../accounting.domain';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ operations: OrderOperationRow[]; costLines: OrderCostLineRow[] }>();
</script>

<template>
  <div class="flex flex-col gap-2 py-1">
    <div v-if="costLines.length" class="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Позиция</TableHead>
            <TableHead class="text-right">Штук</TableHead>
            <TableHead class="text-right">Закуп за штуку</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="line in costLines" :key="line.key">
            <TableCell>
              <div class="max-w-80 truncate">{{ line.title }}</div>
              <div v-if="line.note" class="text-xs text-muted-foreground">{{ line.note }}</div>
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              {{ line.countLabel }}
            </TableCell>
            <TableCell
              class="whitespace-nowrap text-right tabular-nums"
              :class="line.unknown ? 'text-warn' : ''"
            >
              {{ line.unitLabel }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-if="operations.length" class="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Услуга</TableHead>
            <TableHead class="text-right">Сумма</TableHead>
            <TableHead class="text-right">Дата</TableHead>
            <TableHead class="hidden md:table-cell">ID</TableHead>
            <TableHead class="hidden md:table-cell">Площадка</TableHead>
            <TableHead class="hidden md:table-cell">Документ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="op in operations" :key="op.id">
            <TableCell>
              <span>{{ op.title }}</span>
              <Badge v-if="op.manual" class="ml-2">ручная</Badge>
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              {{ op.amountLabel }}
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums text-muted-foreground">
              {{ op.dayLabel }}
            </TableCell>
            <TableCell class="hidden max-w-40 truncate text-xs text-muted-foreground md:table-cell">
              {{ op.id }}
            </TableCell>
            <TableCell class="hidden text-muted-foreground md:table-cell">
              {{ op.marketplaceLabel }}
            </TableCell>
            <TableCell class="hidden max-w-40 truncate text-muted-foreground md:table-cell">
              {{ op.documentLabel }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <p v-if="!operations.length && !costLines.length" class="text-sm text-muted-foreground">
      Операций по строке нет.
    </p>
  </div>
</template>
