<script setup lang="ts">
/**
 * Схемы продаж (FBS/FBY/FBO…) по площадкам. Строки «не относится к товару»
 * схемы не имеют, поэтому Σ схем меньше чистой площадки — сравнивается маржа.
 */
import type { SchemeRow } from '../mappers/mapCompare.marketplace-compare';

import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ rows: readonly SchemeRow[] }>();
</script>

<template>
  <Card class="overflow-x-auto p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Площадка</TableHead>
          <TableHead>Схема</TableHead>
          <TableHead class="text-right">Выручка</TableHead>
          <TableHead class="text-right">Чистая по товарам</TableHead>
          <TableHead class="text-right">Рентабельность</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.key">
          <TableCell class="text-muted-foreground">{{ row.marketplace }}</TableCell>
          <TableCell class="font-medium">{{ row.scheme }}</TableCell>
          <TableCell class="tnum text-right">{{ row.revenue }}</TableCell>
          <TableCell class="tnum text-right">{{ row.net }}</TableCell>
          <TableCell class="tnum text-right font-medium">{{ row.margin }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
