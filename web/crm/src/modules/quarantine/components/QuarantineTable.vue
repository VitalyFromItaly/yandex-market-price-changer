<script setup lang="ts">
/**
 * Товары в карантине: артикул, причина, цена сейчас, последняя валидная и
 * порог. Нет цены — «—»: у низкой цены последней валидной не бывает, у резкой
 * смены — порога, и это не ноль.
 */
import type { QuarantineRow } from '../quarantine.domain';

import { Check } from 'lucide-vue-next';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatRub } from '@/shared/utils';

defineProps<{
  rows: QuarantineRow[];
  selected: Set<string>;
  allSelected: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{
  toggle: [offerId: string, on: boolean];
  toggleAll: [on: boolean];
  confirm: [offerId: string];
}>();

function price(value: number | null): string {
  return value === null ? '—' : formatRub(value);
}
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-10">
            <Checkbox
              label=""
              aria-label="Отметить все"
              :model-value="allSelected"
              :disabled="disabled"
              @update:model-value="emit('toggleAll', $event)"
            />
          </TableHead>
          <TableHead>Артикул</TableHead>
          <TableHead class="hidden md:table-cell">Причина</TableHead>
          <TableHead class="text-right">Цена сейчас</TableHead>
          <TableHead class="text-right">Была до карантина</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Порог Маркета</TableHead>
          <TableHead class="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.offerId">
          <TableCell>
            <Checkbox
              label=""
              :aria-label="`Отметить ${row.offerId}`"
              :model-value="selected.has(row.offerId)"
              :disabled="disabled"
              @update:model-value="emit('toggle', row.offerId, $event)"
            />
          </TableCell>
          <TableCell class="max-w-[16rem] truncate font-mono text-sm" :title="row.offerId">
            {{ row.offerId }}
          </TableCell>
          <TableCell class="hidden text-sm text-muted-foreground md:table-cell">
            <template v-for="(reason, index) in row.reasons" :key="index">
              <template v-if="index > 0"><br /></template>{{ reason }}
            </template>
          </TableCell>
          <TableCell class="tnum text-right">{{ price(row.currentPrice) }}</TableCell>
          <TableCell class="tnum text-right text-muted-foreground">
            {{ price(row.lastValidPrice) }}
          </TableCell>
          <TableCell class="tnum hidden text-right text-muted-foreground sm:table-cell">
            {{ price(row.minPrice) }}
          </TableCell>
          <TableCell class="text-right">
            <Button
              variant="ghost"
              size="sm"
              :disabled="disabled"
              :aria-label="`Подтвердить цену ${row.offerId}`"
              @click="emit('confirm', row.offerId)"
            >
              <Check />
              Подтвердить
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
