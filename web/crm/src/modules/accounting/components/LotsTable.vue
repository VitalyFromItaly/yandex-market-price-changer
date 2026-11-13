<script setup lang="ts">
/**
 * Партии с остатками (TASK-216): товар, закупка, количество, остаток, цена штуки
 * с доп. расходами и стоимость остатка. Распроданная партия приглушена.
 */
import type { AccountingLotRow } from '../accounting.domain';

import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ rows: AccountingLotRow[] }>();
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Товар</TableHead>
          <TableHead>Закупка</TableHead>
          <TableHead class="text-right">Куплено</TableHead>
          <TableHead class="text-right">Остаток</TableHead>
          <TableHead class="text-right">Цена за шт.</TableHead>
          <TableHead class="text-right">Стоимость остатка</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="row in rows"
          :key="row.key"
          :class="row.soldOut ? 'text-muted-foreground' : ''"
        >
          <TableCell>
            <div class="font-medium">{{ row.productLabel }}</div>
            <div class="text-xs text-muted-foreground">{{ row.skuLabel }}</div>
            <div v-if="row.unmatchedNote" class="text-xs text-warn">{{ row.unmatchedNote }}</div>
          </TableCell>
          <TableCell>
            <div>{{ row.supplierLabel }}</div>
            <div class="text-xs text-muted-foreground">{{ row.receivedLabel }}</div>
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">
            {{ row.countLabel }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">
            {{ row.remainingLabel }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">
            <div>{{ row.unitCostLabel }}</div>
            <div v-if="row.unitCostNote" class="text-xs text-muted-foreground">
              {{ row.unitCostNote }}
            </div>
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">
            {{ row.remainingCostLabel }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
