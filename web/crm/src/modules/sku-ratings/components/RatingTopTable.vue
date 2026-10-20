<script setup lang="ts">
/**
 * ТОП-лист: место, товар и числа строки. Колонка, по которой лист отсортирован,
 * выделена — у «Убыточных» это чистая, у спроса — штуки к прошлому периоду.
 */
import type { Tone, TopMetric, TopRow } from '../sku-ratings.domain';

import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ rows: TopRow[]; metric: TopMetric }>();

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-ok',
  danger: 'text-danger',
  muted: 'text-muted-foreground',
};

const cell = (metric: TopMetric, column: TopMetric) =>
  metric === column ? 'font-medium text-foreground' : 'text-muted-foreground';
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-10 text-right">#</TableHead>
          <TableHead>Товар</TableHead>
          <TableHead class="text-right">Выручка</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Чистая</TableHead>
          <TableHead class="hidden text-right md:table-cell">Рентабельность</TableHead>
          <TableHead class="text-right">Штуки</TableHead>
          <TableHead class="hidden text-right lg:table-cell">Спрос</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.key">
          <TableCell class="text-right tabular-nums text-muted-foreground">{{
            row.place
          }}</TableCell>
          <TableCell>
            <div class="max-w-[22rem] truncate font-medium" :title="row.title">{{ row.title }}</div>
            <div v-if="row.subtitle" class="text-xs text-muted-foreground">{{ row.subtitle }}</div>
          </TableCell>
          <TableCell
            class="whitespace-nowrap text-right tabular-nums"
            :class="cell(metric, 'revenue')"
          >
            {{ row.revenue }}
          </TableCell>
          <TableCell
            class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell"
            :class="cell(metric, 'net')"
          >
            {{ row.net }}
          </TableCell>
          <TableCell
            class="hidden whitespace-nowrap text-right tabular-nums md:table-cell"
            :class="cell(metric, 'margin')"
          >
            {{ row.margin }}
          </TableCell>
          <TableCell
            class="whitespace-nowrap text-right tabular-nums"
            :class="cell(metric, 'units')"
          >
            {{ row.units }}
          </TableCell>
          <TableCell
            class="hidden whitespace-nowrap text-right tabular-nums lg:table-cell"
            :class="[TONE_CLASS[row.demandTone], metric === 'demand' ? 'font-medium' : '']"
          >
            {{ row.demand }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
