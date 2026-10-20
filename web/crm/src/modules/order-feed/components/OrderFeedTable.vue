<script setup lang="ts">
/**
 * Таблица ленты: заказ, площадка, этап, товары, «Продажи» площадки и прибыль
 * по журналу. Прибыль без операций или закупа — причиной, не нулём. Строка
 * открывает заказ.
 */
import type { OrderFeedRow } from '../order-feed.domain';

import { computed, ref, watch } from 'vue';

import {
  dayLabel,
  itemsLabel,
  numberLabel,
  profitLabel,
  salesLabel,
} from '../mappers/orderFeedTable.order-feed';
import { ORDER_FEED_PAGE_ROWS } from '../order-feed.domain';

import MarketplaceMark from '@/components/layout/MarketplaceMark.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const props = defineProps<{ rows: OrderFeedRow[] }>();
const emit = defineEmits<{ open: [row: OrderFeedRow] }>();

const page = ref(1);
const pages = computed(() => Math.max(1, Math.ceil(props.rows.length / ORDER_FEED_PAGE_ROWS)));
const visible = computed(() =>
  props.rows.slice((page.value - 1) * ORDER_FEED_PAGE_ROWS, page.value * ORDER_FEED_PAGE_ROWS),
);
watch(
  () => props.rows,
  () => {
    page.value = 1;
  },
);
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Заказ</TableHead>
          <TableHead>Этап</TableHead>
          <TableHead class="hidden md:table-cell">Товары</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Продажи</TableHead>
          <TableHead class="text-right">Прибыль</TableHead>
          <TableHead class="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in visible" :key="`${row.marketplace}:${row.id}`">
          <TableCell>
            <div class="flex items-center gap-2">
              <MarketplaceMark :marketplace="row.marketplace" size="sm" />
              <div>
                <div class="font-medium tabular-nums">{{ numberLabel(row) }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ dayLabel(row.createdDay)
                  }}<template v-if="row.scheme"> · {{ row.scheme }}</template>
                </div>
              </div>
            </div>
          </TableCell>
          <TableCell>
            <Badge>{{ row.stageLabel }}</Badge>
          </TableCell>
          <TableCell
            class="hidden max-w-80 truncate text-sm md:table-cell"
            :title="itemsLabel(row)"
          >
            {{ itemsLabel(row) }}
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
            {{ salesLabel(row.sales) }}
          </TableCell>
          <TableCell
            class="whitespace-nowrap text-right tabular-nums"
            :class="{
              'text-muted-foreground text-xs': row.profitKopecks === null,
              'text-danger': (row.profitKopecks ?? 0) < 0,
            }"
          >
            {{ profitLabel(row) }}
          </TableCell>
          <TableCell class="text-right">
            <Button variant="ghost" size="sm" @click="emit('open', row)">Открыть</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
  <Pagination v-model:page="page" :pages="pages" />
</template>
