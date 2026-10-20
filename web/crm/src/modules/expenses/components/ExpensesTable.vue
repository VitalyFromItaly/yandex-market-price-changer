<script setup lang="ts">
/**
 * Записи расходов: категория, вид, когда действует, сумма. Ежемесячная сумма —
 * за месяц: в период она ложится по дням, это показывает карточка выше.
 */
import type { ExpenseRow } from '../expenses.domain';

import { Pencil, Trash2 } from 'lucide-vue-next';

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

defineProps<{ rows: ExpenseRow[]; disabled: boolean }>();
const emit = defineEmits<{ edit: [id: string]; remove: [id: string] }>();
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Категория</TableHead>
          <TableHead class="hidden sm:table-cell">Вид</TableHead>
          <TableHead class="hidden md:table-cell">Когда</TableHead>
          <TableHead class="text-right">Сумма</TableHead>
          <TableHead class="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.id">
          <TableCell>
            <div class="font-medium">{{ row.categoryLabel }}</div>
            <div
              v-if="row.note"
              class="max-w-[18rem] truncate text-xs text-muted-foreground"
              :title="row.note"
            >
              {{ row.note }}
            </div>
            <div class="text-xs text-muted-foreground md:hidden">{{ row.whenLabel }}</div>
          </TableCell>
          <TableCell class="hidden text-sm text-muted-foreground sm:table-cell">
            {{ row.kindLabel }}
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-sm text-muted-foreground md:table-cell">
            {{ row.whenLabel }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">
            {{ row.amount }}
            <span v-if="row.amountSuffix" class="text-xs text-muted-foreground">
              {{ row.amountSuffix }}
            </span>
          </TableCell>
          <TableCell class="whitespace-nowrap text-right">
            <Button
              variant="ghost"
              size="sm"
              :aria-label="`Изменить ${row.categoryLabel}`"
              :disabled="disabled"
              @click="emit('edit', row.id)"
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :aria-label="`Удалить ${row.categoryLabel}`"
              :disabled="disabled"
              @click="emit('remove', row.id)"
            >
              <Trash2 />
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
