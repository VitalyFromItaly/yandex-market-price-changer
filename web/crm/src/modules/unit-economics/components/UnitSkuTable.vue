<script setup lang="ts">
/**
 * Товары периода: выручка, прибыль, рентабельность и изменение к прошлому
 * периоду. Строка — кнопка, открывающая карточку товара.
 */
import type { Tone, UnitRow } from '../unit-economics.domain';

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

defineProps<{ rows: UnitRow[] }>();
const emit = defineEmits<{ open: [sku: string] }>();

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-ok',
  danger: 'text-danger',
  muted: 'text-muted-foreground',
};
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Товар</TableHead>
          <TableHead class="text-right">Продано</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Выручка</TableHead>
          <TableHead class="text-right">Прибыль</TableHead>
          <TableHead class="hidden text-right md:table-cell">На штуку</TableHead>
          <TableHead class="hidden text-right md:table-cell">Рентаб.</TableHead>
          <TableHead class="hidden text-right lg:table-cell">К прошлому</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="row in rows"
          :key="row.sku"
          class="cursor-pointer"
          tabindex="0"
          role="button"
          :aria-label="`Открыть карточку: ${row.title}`"
          @click="emit('open', row.sku)"
          @keydown.enter.prevent="emit('open', row.sku)"
          @keydown.space.prevent="emit('open', row.sku)"
        >
          <TableCell>
            <div class="max-w-[22rem] truncate font-medium" :title="row.title">{{ row.title }}</div>
            <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span v-if="row.subtitle">{{ row.subtitle }}</span>
              <Badge v-if="row.scheme" variant="outline">{{ row.scheme }}</Badge>
              <Badge v-if="!row.costKnown" variant="warn">нет себестоимости</Badge>
            </div>
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">{{ row.units }}</TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
            {{ row.revenue }}
          </TableCell>
          <TableCell
            class="whitespace-nowrap text-right font-medium tabular-nums"
            :class="TONE_CLASS[row.netTone]"
          >
            {{ row.net }}
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
            {{ row.unitNet }}
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
            {{ row.margin }}
          </TableCell>
          <TableCell
            class="hidden whitespace-nowrap text-right tabular-nums lg:table-cell"
            :class="TONE_CLASS[row.deltaTone]"
          >
            {{ row.delta ?? 'не продавался' }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
