<script setup lang="ts">
/**
 * Суммы карточки заказа по ТЗ п.4 (TASK-223): строка — сумма и её происхождение
 * («ожидается», «распределено», «оценка», «Неизвестная закупка»); клик раскрывает
 * операции. Числа — с сервера.
 */
import type { OrderAmountKey, OrderAmountRow, OrderAmountTag } from '../accounting.domain';

import { ChevronDown, ChevronRight } from 'lucide-vue-next';
import { ref } from 'vue';

import OrderOperationsTable from './OrderOperationsTable.vue';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ rows: OrderAmountRow[] }>();

/** Неизвестное ждёт человека (warn); происхождение суммы — нейтрально. */
const TAG_VARIANT: Record<OrderAmountTag, 'warn' | 'outline'> = {
  expected: 'outline',
  allocated: 'outline',
  estimate: 'outline',
  unknown_cogs: 'warn',
  unknown: 'warn',
};

const expanded = ref<OrderAmountKey | null>(null);
function toggle(key: OrderAmountKey): void {
  expanded.value = expanded.value === key ? null : key;
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Статья</TableHead>
          <TableHead class="text-right">Сумма</TableHead>
          <TableHead class="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-for="row in rows" :key="row.key">
          <TableRow>
            <TableCell>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="font-medium">{{ row.title }}</span>
                <Badge v-for="tag in row.tags" :key="tag.tag" :variant="TAG_VARIANT[tag.tag]">
                  {{ tag.label }}
                </Badge>
              </div>
              <div v-for="note in row.notes" :key="note" class="text-xs text-muted-foreground">
                {{ note }}
              </div>
            </TableCell>
            <TableCell
              class="whitespace-nowrap text-right tabular-nums"
              :class="row.unknown ? 'text-warn' : ''"
            >
              {{ row.amountLabel }}
            </TableCell>
            <TableCell>
              <Button
                v-if="row.expandable"
                variant="ghost"
                size="sm"
                :aria-expanded="expanded === row.key"
                :aria-label="`Операции: ${row.title}`"
                @click="toggle(row.key)"
              >
                <component
                  :is="expanded === row.key ? ChevronDown : ChevronRight"
                  aria-hidden="true"
                />
              </Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="expanded === row.key">
            <TableCell colspan="3">
              <OrderOperationsTable :operations="row.operations" :cost-lines="row.costLines" />
            </TableCell>
          </TableRow>
        </template>
      </TableBody>
    </Table>
  </div>
</template>
