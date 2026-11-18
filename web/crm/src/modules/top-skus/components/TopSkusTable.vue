<script setup lang="ts">
/**
 * Все проданные товары периода. При разрезах по месту строка раскрывается в регионы и
 * кластеры этого товара (данные уже в ответе — раскрытие запроса не делает).
 */
import type { TopSkuRow } from '../top-skus.domain';

import { ChevronDown, ChevronRight } from 'lucide-vue-next';
import { ref } from 'vue';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatRub } from '@/shared/utils';

defineProps<{ rows: TopSkuRow[]; places: boolean }>();

const open = ref<Set<string>>(new Set());
function toggle(sku: string): void {
  const next = new Set(open.value);
  if (next.has(sku)) next.delete(sku);
  else next.add(sku);
  open.value = next;
}

const margin = (value: number | null): string =>
  value === null ? '—' : `${Math.round(value * 1000) / 10}%`;
const regionsText = (row: TopSkuRow): string =>
  (row.byRegion ?? []).map((p) => `${p.name} — ${formatCount(p.count)} шт.`).join(' · ');
const clustersText = (row: TopSkuRow): string =>
  (row.byCluster ?? []).map((p) => `${p.name} — ${formatCount(p.count)} шт.`).join(' · ');
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-10 text-right">№</TableHead>
          <TableHead>Товар</TableHead>
          <TableHead class="text-right">Штуки</TableHead>
          <TableHead class="text-right">Продажи</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Чистая</TableHead>
          <TableHead class="hidden text-right md:table-cell">Маржа</TableHead>
          <TableHead class="hidden text-right md:table-cell">Возвраты</TableHead>
          <TableHead v-if="places" class="w-10"><span class="sr-only">Где продано</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-for="(row, index) in rows" :key="row.sku">
          <TableRow>
            <TableCell class="text-right tabular-nums text-muted-foreground">
              {{ index + 1 }}
            </TableCell>
            <TableCell>
              <div class="max-w-[24rem] truncate font-medium" :title="row.name">{{ row.name }}</div>
              <div class="text-xs text-muted-foreground">{{ row.sku }}</div>
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              {{ formatCount(row.count) }}
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              {{ formatRub(row.revenue) }}
            </TableCell>
            <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
              {{ formatRub(row.net) }}
            </TableCell>
            <TableCell class="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
              {{ margin(row.margin) }}
            </TableCell>
            <TableCell class="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
              {{ row.returns ? formatCount(row.returns) : '—' }}
            </TableCell>
            <TableCell v-if="places">
              <Button
                variant="ghost"
                size="sm"
                :aria-label="`Где продано: ${row.name}`"
                :aria-expanded="open.has(row.sku)"
                @click="toggle(row.sku)"
              >
                <ChevronDown v-if="open.has(row.sku)" />
                <ChevronRight v-else />
              </Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="places && open.has(row.sku)" class="bg-muted/40">
            <TableCell />
            <TableCell colspan="7" class="text-xs text-muted-foreground">
              <div>
                <span class="font-medium text-foreground">Регионы:</span> {{ regionsText(row) }}
              </div>
              <div class="mt-1">
                <span class="font-medium text-foreground">Кластеры:</span> {{ clustersText(row) }}
              </div>
            </TableCell>
          </TableRow>
        </template>
      </TableBody>
    </Table>
  </Card>
</template>
