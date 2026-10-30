<script setup lang="ts">
/**
 * Площадка в плане: статус, причина блокировки, строки «было → станет» с
 * галочкой. Рискованные (|Δ| > 50% или без текущей цены) подсвечены и сняты по
 * умолчанию — решает сервер (`risky`), фронт только показывает.
 */
import type { PriceSetTarget } from '../price-set.domain';

import { computed } from 'vue';

import { deltaText, priceText, targetStatus } from '../mappers/mapPriceSet.price-set';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const SKIPPED_SHOWN = 50;

const props = defineProps<{
  target: PriceSetTarget;
  count: number;
  isIncluded: (key: string) => boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ toggleRow: [key: string, on: boolean] }>();

const status = computed(() => targetStatus(props.target, props.count));
const risky = computed(() => props.target.updates.filter((row) => row.risky).length);
const counts = computed(() => {
  const t = props.target;
  const parts = [`изменится: ${t.updates.length}`, `без изменений: ${t.unchanged}`];
  if (risky.value) parts.push(`под вопросом: ${risky.value}`);
  if (t.skipped.length) parts.push(`пропущено: ${t.skipped.length}`);
  return parts.join(' · ');
});
</script>

<template>
  <Card>
    <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-2">
      <div class="flex flex-col gap-1">
        <CardTitle>{{ target.marketplaceLabel }}</CardTitle>
        <p class="text-sm text-muted-foreground tabular-nums">{{ counts }}</p>
      </div>
      <Badge :variant="status.variant">{{ status.label }}</Badge>
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      <p v-if="target.blockedText" class="text-sm">{{ target.blockedText }}</p>
      <p v-if="target.error" class="text-sm text-muted-foreground">Причина: {{ target.error }}</p>
      <p v-if="risky" class="text-sm text-muted-foreground">
        Подсвеченные строки меняют цену больше чем наполовину или у товара нет текущей цены — они
        сняты. Поставьте галочку, если уверены.
      </p>

      <Table v-if="target.updates.length">
        <TableHeader>
          <TableRow>
            <TableHead class="w-10"><span class="sr-only">Записать</span></TableHead>
            <TableHead>Артикул</TableHead>
            <TableHead class="text-right">Было</TableHead>
            <TableHead class="text-right">Станет</TableHead>
            <TableHead class="text-right">Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="row in target.updates"
            :key="row.key"
            :class="cn(row.risky && 'bg-warn-subtle')"
          >
            <TableCell>
              <Checkbox
                :model-value="isIncluded(row.key)"
                label=""
                :aria-label="`Записать цену ${row.sku}`"
                :disabled="disabled || !target.willWrite"
                @update:model-value="emit('toggleRow', row.key, $event)"
              />
            </TableCell>
            <TableCell>
              <div class="font-medium">{{ row.sku }}</div>
              <div v-if="row.name" class="text-xs text-muted-foreground">{{ row.name }}</div>
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ priceText(row.from) }}</TableCell>
            <TableCell class="text-right font-medium tabular-nums">{{
              priceText(row.to)
            }}</TableCell>
            <TableCell :class="cn('text-right tabular-nums', row.risky && 'font-medium text-warn')">
              {{ deltaText(row.deltaPct) }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <details v-if="target.skipped.length" class="text-sm">
        <summary class="cursor-pointer text-muted-foreground">
          Пропущено: {{ target.skipped.length }} — почему
        </summary>
        <ul class="mt-2 flex flex-col gap-1 text-muted-foreground">
          <li v-for="item in target.skipped.slice(0, SKIPPED_SHOWN)" :key="item.sku">
            {{ item.sku }}<template v-if="item.name"> · {{ item.name }}</template> —
            {{ item.reasonText }}
          </li>
          <li v-if="target.skipped.length > SKIPPED_SHOWN">
            …и ещё {{ target.skipped.length - SKIPPED_SHOWN }}
          </li>
        </ul>
      </details>
    </CardContent>
  </Card>
</template>
