<script setup lang="ts">
/**
 * Карточки площадок, не привязанные к товару: числа есть, свести не к чему.
 * Показываются, а не теряются — привязка делается в «Товарах».
 */
import type { InventoryUnmatched } from '../inventory.domain';

import { countLabel } from '../mappers/inventoryTable.inventory';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const LABEL: Record<InventoryUnmatched['marketplace'], string> = {
  ym: 'Яндекс Маркет',
  ozon: 'Ozon',
  wb: 'Wildberries',
};

defineProps<{ rows: readonly InventoryUnmatched[] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Не привязано к товарам — {{ rows.length }}</CardTitle>
      <p class="text-sm text-muted-foreground">
        Карточки площадок без товара: в строки выше они не вошли. Привязка — в разделе «Товары».
      </p>
    </CardHeader>
    <CardContent class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Площадка</TableHead>
            <TableHead>Артикул</TableHead>
            <TableHead class="text-right">FBS</TableHead>
            <TableHead class="text-right">Склад площадки</TableHead>
            <TableHead class="hidden text-right sm:table-cell">В пути</TableHead>
            <TableHead class="hidden text-right sm:table-cell">Возвраты</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in rows" :key="`${row.marketplace}:${row.sku}`">
            <TableCell>{{ LABEL[row.marketplace] }}</TableCell>
            <TableCell class="max-w-56 truncate font-medium" :title="row.sku">{{
              row.sku
            }}</TableCell>
            <TableCell class="tnum text-right">{{ countLabel(row.seller) }}</TableCell>
            <TableCell class="tnum text-right">{{ countLabel(row.marketplaceStock) }}</TableCell>
            <TableCell class="tnum hidden text-right sm:table-cell">{{
              countLabel(row.inTransit)
            }}</TableCell>
            <TableCell class="tnum hidden text-right sm:table-cell">{{
              countLabel(row.returning)
            }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </CardContent>
  </Card>
</template>
