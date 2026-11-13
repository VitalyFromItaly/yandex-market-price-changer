<script setup lang="ts">
/**
 * Операции месяца без номера заказа (TASK-228) — уровень магазина: сводная
 * строка акта (подписка, хранение, продвижение…) и ручные без заказа. В
 * заказы они не распределяются, но и не теряются.
 */
import type { ReconcileStoreLevelRow } from '../accounting.domain';

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

defineProps<{
  rows: ReconcileStoreLevelRow[];
  more: number;
  totalLabel: string;
  summary: string;
}>();
</script>

<template>
  <section class="flex flex-col gap-2">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold">Без заказа — уровень магазина</h3>
      <span class="text-sm text-muted-foreground">{{ summary }}</span>
    </div>
    <Card v-if="!rows.length" class="p-4 text-sm text-muted-foreground">
      Операций без номера заказа за месяц нет.
    </Card>
    <Card v-else class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Дата</TableHead>
            <TableHead>Операция</TableHead>
            <TableHead class="text-right">Сумма</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in rows" :key="row.id">
            <TableCell class="whitespace-nowrap tabular-nums">{{ row.dayLabel }}</TableCell>
            <TableCell>
              {{ row.title }}
              <Badge v-if="row.manual" variant="default" class="ml-2">ручная</Badge>
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              {{ row.amountLabel }}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell colspan="2" class="font-medium">
              Итого<template v-if="more > 0"> (ещё {{ more }} не показаны)</template>
            </TableCell>
            <TableCell class="whitespace-nowrap text-right font-medium tabular-nums">
              {{ totalLabel }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  </section>
</template>
