<script setup lang="ts">
/**
 * Таблица разреза возвратов — бренды, товары или площадки. Колонки одни на все
 * разрезы (строки строит `toReturnsRow`). Полоса у потерь — доля от крупнейшей
 * строки. «Итого» — тот же итог, что в карточках; у площадок его нет: площадки
 * в одно число не складываются.
 */
import type { ReturnsRow } from '../returns-analytics.domain';

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

const props = withDefaults(
  defineProps<{
    rows: ReturnsRow[];
    /** Подпись первой колонки: «Бренд», «Товар», «Площадка». */
    title: string;
    rest?: ReturnsRow | null;
    total?: ReturnsRow | null;
  }>(),
  { rest: null, total: null },
);

const max = computed(() => Math.max(0, ...props.rows.map((row) => row.lossesKopecks)));

const NUM = 'whitespace-nowrap text-right tabular-nums';
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{{ title }}</TableHead>
          <TableHead class="text-right">Штуки</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Заказы</TableHead>
          <TableHead class="text-right">% выкупов</TableHead>
          <TableHead class="hidden text-right md:table-cell">Сумма</TableHead>
          <TableHead class="hidden text-right lg:table-cell">Обр. логистика</TableHead>
          <TableHead class="hidden text-right lg:table-cell">Удержания</TableHead>
          <TableHead class="hidden text-right xl:table-cell">Комиссии</TableHead>
          <TableHead class="hidden text-right xl:table-cell">Компенсации</TableHead>
          <TableHead class="text-right">Потери</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="row in [...rows, ...(rest ? [rest] : []), ...(total ? [total] : [])]"
          :key="row.key"
          :class="{
            'text-muted-foreground': row.key === 'rest',
            'font-medium': row.key === 'total',
          }"
        >
          <TableCell>
            <div
              class="max-w-[22rem] truncate"
              :class="{ 'font-medium': row.key !== 'rest' }"
              :title="row.title"
            >
              {{ row.title }}
            </div>
            <div v-if="row.subtitle" class="text-xs text-muted-foreground">{{ row.subtitle }}</div>
          </TableCell>
          <TableCell :class="NUM">{{ row.units }}</TableCell>
          <TableCell :class="[NUM, 'hidden sm:table-cell']">{{ row.orders }}</TableCell>
          <TableCell :class="NUM">{{ row.rate }}</TableCell>
          <TableCell :class="[NUM, 'hidden md:table-cell']">{{ row.amount }}</TableCell>
          <TableCell :class="[NUM, 'hidden lg:table-cell']">{{ row.logistics }}</TableCell>
          <TableCell :class="[NUM, 'hidden lg:table-cell']">{{ row.withholdings }}</TableCell>
          <TableCell :class="[NUM, 'hidden xl:table-cell']">{{ row.commission }}</TableCell>
          <TableCell :class="[NUM, 'hidden xl:table-cell']">{{ row.compensations }}</TableCell>
          <TableCell class="min-w-32 text-right">
            <div class="whitespace-nowrap tabular-nums">{{ row.losses }}</div>
            <DataBar
              v-if="row.key !== 'total' && row.key !== 'rest'"
              :value="Math.max(row.lossesKopecks, 0)"
              :max="max"
              class="mt-1"
            />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
