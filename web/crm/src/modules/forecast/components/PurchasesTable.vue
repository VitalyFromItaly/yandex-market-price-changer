<script setup lang="ts">
/**
 * Необходимые закупки: товар, скорость, остаток, на сколько хватит и сколько
 * докупить до выбранного запаса. Первыми — те, что кончатся раньше; меньше
 * недели — подсвечено.
 */
import type { PurchaseView } from '../forecast.domain';

import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ rows: PurchaseView[] }>();
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Товар</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Скорость</TableHead>
          <TableHead class="text-right">Остаток</TableHead>
          <TableHead class="text-right">Хватит на</TableHead>
          <TableHead class="text-right">Докупить</TableHead>
          <TableHead class="hidden text-right md:table-cell">Сумма закупа</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.sku">
          <TableCell>
            <div class="max-w-[22rem] truncate font-medium" :title="row.name">{{ row.name }}</div>
            <div class="text-xs text-muted-foreground">{{ row.sku }}</div>
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
            {{ row.speed }}
          </TableCell>
          <TableCell class="text-right tabular-nums">{{ row.stock }}</TableCell>
          <TableCell
            class="whitespace-nowrap text-right tabular-nums"
            :class="row.urgent ? 'font-medium text-danger' : 'text-muted-foreground'"
          >
            {{ row.daysLeft }}
          </TableCell>
          <TableCell class="text-right font-medium tabular-nums">{{ row.need }}</TableCell>
          <TableCell
            class="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground md:table-cell"
          >
            {{ row.needSum }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
