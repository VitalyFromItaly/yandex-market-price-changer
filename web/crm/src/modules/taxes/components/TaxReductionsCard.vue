<script setup lang="ts">
/**
 * Уменьшения налога — взносы ИП и прочее, вводятся руками. Уменьшают только
 * УСН «Доходы»; в «Доходы минус расходы» взносы — расход, их место в «Расходах».
 */
import type { TaxReductionRow } from '../taxes.domain';

import { Pencil, Plus, Trash2 } from 'lucide-vue-next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{
  rows: TaxReductionRow[];
  reductionsApply: boolean;
  hasStaff: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{
  add: [];
  edit: [id: string];
  remove: [id: string];
  staff: [value: boolean];
}>();
</script>

<template>
  <Card>
    <CardHeader class="flex flex-row items-start justify-between gap-4">
      <div class="flex flex-col gap-1.5">
        <CardTitle>Уменьшения налога</CardTitle>
        <CardDescription v-if="reductionsApply">
          Взносы уменьшают налог периода, в котором уплачены: без работников — до нуля, с
          работниками — до доли из параметров года.
        </CardDescription>
        <CardDescription v-else>
          В режиме «Доходы минус расходы» взносы налог не уменьшают — внесите их в «Расходы».
        </CardDescription>
      </div>
      <Button variant="outline" size="sm" :disabled="disabled" @click="emit('add')">
        <Plus />
        Внести
      </Button>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <Checkbox
        v-if="reductionsApply"
        label="Есть работники"
        :model-value="hasStaff"
        :disabled="disabled"
        @update:model-value="emit('staff', $event)"
      />
      <p v-if="rows.length === 0" class="text-sm text-muted-foreground">Уменьшений пока нет.</p>
      <div v-else class="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Вид</TableHead>
              <TableHead class="text-right">Сумма</TableHead>
              <TableHead class="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in rows" :key="row.id">
              <TableCell class="whitespace-nowrap text-muted-foreground">{{ row.day }}</TableCell>
              <TableCell>
                {{ row.kind }}
                <div
                  v-if="row.note"
                  class="truncate text-xs text-muted-foreground"
                  :title="row.note"
                >
                  {{ row.note }}
                </div>
              </TableCell>
              <TableCell class="whitespace-nowrap text-right tabular-nums">{{
                row.amount
              }}</TableCell>
              <TableCell class="whitespace-nowrap">
                <Button
                  variant="ghost"
                  size="sm"
                  :aria-label="`Изменить уменьшение ${row.day}`"
                  :disabled="disabled"
                  @click="emit('edit', row.id)"
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :aria-label="`Удалить уменьшение ${row.day}`"
                  :disabled="disabled"
                  @click="emit('remove', row.id)"
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
</template>
