<script setup lang="ts">
/**
 * Продажи по времени: один ряд столбцов выбранной метрики (одна ось — скил
 * dataviz; две метрики разного масштаба на одном графике запрещены) и таблица
 * тех же корзин под ним — график дополняет таблицу, а не заменяет её.
 */
import type { SalesBucket, SalesMetric } from '../sales-analytics.domain';

import { computed } from 'vue';

import { METRIC_FORMAT, chartPoints } from '../mappers/mapSalesAnalytics.sales-analytics';
import { SALES_METRIC_OPTIONS } from '../sales-analytics.domain';

import { Card } from '@/components/ui/card';
import { BarChart } from '@/components/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatKopecks } from '@/shared/utils';

const props = defineProps<{ buckets: SalesBucket[]; metric: SalesMetric }>();

const points = computed(() => chartPoints(props.buckets, props.metric));
const metricLabel = computed(
  () => SALES_METRIC_OPTIONS.find((option) => option.value === props.metric)?.label ?? '',
);
const avgCheck = (bucket: SalesBucket): string =>
  bucket.orders > 0 ? formatKopecks(Math.round(bucket.revenueKopecks / bucket.orders)) : '—';
</script>

<template>
  <Card class="p-4">
    <BarChart
      :points="points"
      :label="`${metricLabel} по периоду`"
      :format="METRIC_FORMAT[metric]"
      :height="240"
    />
  </Card>

  <Card class="max-h-[28rem] overflow-auto p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Период</TableHead>
          <TableHead class="text-right">Выручка</TableHead>
          <TableHead class="text-right">Заказы</TableHead>
          <TableHead class="text-right">Штуки</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Средний чек</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="bucket in buckets" :key="bucket.key">
          <TableCell class="whitespace-nowrap tabular-nums">{{ bucket.label }}</TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">
            {{ formatKopecks(bucket.revenueKopecks) }}
          </TableCell>
          <TableCell class="text-right tabular-nums">{{ formatCount(bucket.orders) }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ formatCount(bucket.units) }}</TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
            {{ avgCheck(bucket) }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
