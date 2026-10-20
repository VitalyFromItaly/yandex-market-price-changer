<script setup lang="ts">
/** Площадка (магазин ЯМ, Ozon, WB): статус, причина блокировки и строки «было → станет». */
import type { StockPushTarget } from '../stock-push.domain';

import { computed } from 'vue';

import { deltaText, targetStatus } from '../mappers/mapStockPush.stock-push';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const props = defineProps<{ target: StockPushTarget }>();

const status = computed(() => targetStatus(props.target));
const counts = computed(() => {
  const t = props.target;
  const parts = [`без изменений: ${t.unchanged}`];
  if (t.notListed) parts.push(`нет в остатках площадки: ${t.notListed}`);
  if (t.zeroed) parts.push(`обнулится: ${t.zeroed}`);
  return parts.join(' · ');
});
</script>

<template>
  <Card>
    <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-2">
      <div class="flex flex-col gap-1">
        <CardTitle>{{ target.marketplaceLabel }} · {{ target.name }}</CardTitle>
        <p class="text-sm text-muted-foreground">
          <template v-if="target.placement">{{ target.placement }} · </template>{{ counts }}
        </p>
      </div>
      <Badge :variant="status.variant">{{ status.label }}</Badge>
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      <p v-if="target.blockedText" class="text-sm">{{ target.blockedText }}.</p>
      <p v-if="target.error" class="text-sm text-muted-foreground">Причина: {{ target.error }}</p>

      <Table v-if="target.updates.length">
        <TableHeader>
          <TableRow>
            <TableHead>Товар</TableHead>
            <TableHead class="text-right">Прайс</TableHead>
            <TableHead class="text-right">Продано после</TableHead>
            <TableHead class="text-right">Сейчас</TableHead>
            <TableHead class="text-right">Станет</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in target.updates" :key="row.sku">
            <TableCell>
              <div class="font-medium">{{ row.internalSku }}</div>
              <div v-if="row.name" class="text-xs text-muted-foreground">{{ row.name }}</div>
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ row.priceListStock }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ row.sold }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ row.from }}</TableCell>
            <TableCell class="text-right tabular-nums font-medium">
              {{ row.to }}
              <span class="ml-1 text-xs text-muted-foreground">{{
                deltaText(row.from, row.to)
              }}</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </CardContent>
  </Card>
</template>
