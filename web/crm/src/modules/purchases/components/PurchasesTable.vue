<script setup lang="ts">
/**
 * Закупки партий: поставщик, день оплаты, сумма. В ДДС закупка ложится в день
 * оплаты; на чистую прибыль не влияет — себестоимость P&L берёт по продажам.
 */
import type { PurchaseRow } from '../purchases.domain';

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

defineProps<{ rows: PurchaseRow[]; disabled: boolean }>();
const emit = defineEmits<{ edit: [id: string]; remove: [id: string] }>();
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Поставщик</TableHead>
          <TableHead class="hidden sm:table-cell">Оплачено</TableHead>
          <TableHead class="text-right">Сумма</TableHead>
          <TableHead class="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.id">
          <TableCell>
            <div class="font-medium">{{ row.supplier }}</div>
            <div class="text-xs text-muted-foreground">
              <span class="sm:hidden">{{ row.day }}</span>
              <span v-if="row.linesLabel"> {{ row.linesLabel }}</span>
            </div>
            <div
              v-if="row.note"
              class="max-w-[18rem] truncate text-xs text-muted-foreground"
              :title="row.note"
            >
              {{ row.note }}
            </div>
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">
            {{ row.day }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">{{ row.amount }}</TableCell>
          <TableCell class="whitespace-nowrap text-right">
            <Button
              variant="ghost"
              size="sm"
              :aria-label="`Изменить закупку у ${row.supplier}`"
              :disabled="disabled"
              @click="emit('edit', row.id)"
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :aria-label="`Удалить закупку у ${row.supplier}`"
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
