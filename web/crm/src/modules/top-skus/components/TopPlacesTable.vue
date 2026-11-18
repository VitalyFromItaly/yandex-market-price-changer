<script setup lang="ts">
/**
 * Разрез продаж по месту — регионы покупателей или кластеры отгрузки. Строки и доли — с
 * сервера (`byRegion`/`byCluster` того же расчёта): сумма продаж по строкам = итог топа.
 */
import type { TopPlaceView } from '../top-skus.domain';

import { computed } from 'vue';

import { Card } from '@/components/ui/card';
import { DataBar } from '@/components/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatRub } from '@/shared/utils';

const props = defineProps<{ rows: TopPlaceView[]; title: string }>();

const max = computed(() => Math.max(0, ...props.rows.map((row) => row.revenue)));
const share = (value: number | null): string =>
  value === null ? '—' : `${Math.round(value * 1000) / 10}%`;
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{{ title }}</TableHead>
          <TableHead class="text-right">Продажи</TableHead>
          <TableHead class="text-right">Доля</TableHead>
          <TableHead class="text-right">Штуки</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Чистая</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.name">
          <TableCell class="font-medium">{{ row.name }}</TableCell>
          <TableCell class="min-w-32 text-right">
            <div class="whitespace-nowrap tabular-nums">{{ formatRub(row.revenue) }}</div>
            <DataBar :value="Math.max(row.revenue, 0)" :max="max" class="mt-1" />
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">
            {{ share(row.share) }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">
            {{ formatCount(row.count) }}
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
            {{ formatRub(row.net) }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
