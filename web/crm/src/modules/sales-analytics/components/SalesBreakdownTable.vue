<script setup lang="ts">
/**
 * Таблица разреза — бренды, товары или площадки. Колонки одни на все разрезы
 * (строки строит `toSalesRow`). Полоса у выручки — доля от крупнейшей строки,
 * число печатает сама таблица. «Итого» внизу — тот же итог, что в карточках,
 * а строка «не относится к товару» замыкает сумму выручки и штук.
 */
import type { SalesRow, Tone } from '../sales-analytics.domain';

import { computed } from 'vue';

import { REST_TITLE } from '../sales-analytics.domain';

import { Badge } from '@/components/ui/badge';
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

const props = withDefaults(
  defineProps<{
    rows: SalesRow[];
    /** Подпись первой колонки: «Бренд», «Товар», «Площадка». */
    title: string;
    total: SalesRow;
    rest?: { revenue: string; units: string } | null;
    /** Площадки без данных — строкой «скоро», без нулей. */
    upcoming?: { key: string; label: string }[];
  }>(),
  { rest: null, upcoming: () => [] },
);

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-ok',
  danger: 'text-danger',
  muted: 'text-muted-foreground',
};

const max = computed(() => Math.max(0, ...props.rows.map((row) => row.revenueKopecks)));
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{{ title }}</TableHead>
          <TableHead class="text-right">Выручка</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Заказы</TableHead>
          <TableHead class="text-right">Штуки</TableHead>
          <TableHead class="hidden text-right md:table-cell">Средний чек</TableHead>
          <TableHead class="hidden text-right md:table-cell">Скорость</TableHead>
          <TableHead class="hidden text-right lg:table-cell">К прошлому</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.key">
          <TableCell>
            <div class="max-w-[22rem] truncate font-medium" :title="row.title">{{ row.title }}</div>
            <div v-if="row.subtitle" class="text-xs text-muted-foreground">{{ row.subtitle }}</div>
          </TableCell>
          <TableCell class="min-w-32 text-right">
            <div class="whitespace-nowrap tabular-nums">{{ row.revenue }}</div>
            <DataBar :value="Math.max(row.revenueKopecks, 0)" :max="max" class="mt-1" />
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
            {{ row.orders }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">{{ row.units }}</TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
            {{ row.avgCheck }}
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
            {{ row.velocity }}
          </TableCell>
          <TableCell
            class="hidden whitespace-nowrap text-right tabular-nums lg:table-cell"
            :class="TONE_CLASS[row.deltaTone]"
          >
            {{ row.delta ?? '—' }}
          </TableCell>
        </TableRow>

        <TableRow v-for="mp in upcoming" :key="mp.key" class="text-muted-foreground">
          <TableCell class="font-medium">{{ mp.label }}</TableCell>
          <TableCell colspan="6" class="text-right">
            <Badge variant="outline">скоро</Badge>
          </TableCell>
        </TableRow>

        <TableRow v-if="rest" class="text-muted-foreground">
          <TableCell>{{ REST_TITLE }}</TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">{{
            rest.revenue
          }}</TableCell>
          <TableCell class="hidden sm:table-cell" />
          <TableCell class="whitespace-nowrap text-right tabular-nums">{{ rest.units }}</TableCell>
          <TableCell class="hidden md:table-cell" />
          <TableCell class="hidden md:table-cell" />
          <TableCell class="hidden lg:table-cell" />
        </TableRow>

        <TableRow class="font-medium">
          <TableCell>Итого</TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">{{
            total.revenue
          }}</TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
            {{ total.orders }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">{{ total.units }}</TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
            {{ total.avgCheck }}
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
            {{ total.velocity }}
          </TableCell>
          <TableCell
            class="hidden whitespace-nowrap text-right tabular-nums lg:table-cell"
            :class="TONE_CLASS[total.deltaTone]"
          >
            {{ total.delta ?? '—' }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
