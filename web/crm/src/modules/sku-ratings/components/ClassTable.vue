<script setup lang="ts">
/**
 * Классы товаров: ABC по выручке, ABC по прибыли (или почему его нет) и XYZ с
 * коэффициентом вариации. Строки — все товары периода по выручке.
 */
import type { ClassRow } from '../sku-ratings.domain';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ rows: ClassRow[]; withXyz: boolean }>();

type Variant = 'ok' | 'warn' | 'outline';

/** Лучший класс — зелёный, средний — жёлтый, худший — без цвета: это не авария. */
const VARIANT: Record<string, Variant> = {
  A: 'ok',
  B: 'warn',
  C: 'outline',
  X: 'ok',
  Y: 'warn',
  Z: 'outline',
};
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Товар</TableHead>
          <TableHead class="text-right">Выручка</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Штуки</TableHead>
          <TableHead class="text-center">ABC выручки</TableHead>
          <TableHead class="text-center">ABC прибыли</TableHead>
          <template v-if="withXyz">
            <TableHead class="text-center">XYZ</TableHead>
            <TableHead class="hidden text-right md:table-cell">Вариация</TableHead>
          </template>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.key">
          <TableCell>
            <div class="max-w-[22rem] truncate font-medium" :title="row.title">{{ row.title }}</div>
            <div v-if="row.subtitle" class="text-xs text-muted-foreground">{{ row.subtitle }}</div>
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">{{ row.revenue }}</TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
            {{ row.units }}
          </TableCell>
          <TableCell class="text-center">
            <Badge v-if="row.abcRevenue" :variant="VARIANT[row.abcRevenue]">{{
              row.abcRevenue
            }}</Badge>
            <span v-else class="text-muted-foreground">—</span>
          </TableCell>
          <TableCell class="text-center">
            <Badge v-if="row.abcProfit" :variant="VARIANT[row.abcProfit]">{{
              row.abcProfit
            }}</Badge>
            <span v-else class="whitespace-nowrap text-xs text-muted-foreground">
              {{ row.abcProfitNote ?? '—' }}
            </span>
          </TableCell>
          <template v-if="withXyz">
            <TableCell class="text-center">
              <Badge v-if="row.xyz" :variant="VARIANT[row.xyz]">{{ row.xyz }}</Badge>
              <span v-else class="whitespace-nowrap text-xs text-muted-foreground">нет продаж</span>
            </TableCell>
            <TableCell class="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
              {{ row.cv }}
            </TableCell>
          </template>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
