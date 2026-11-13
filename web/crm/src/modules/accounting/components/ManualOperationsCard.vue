<script setup lang="ts">
/**
 * Ручные операции реестра (TASK-208): дата, площадка, статья, сумма со знаком,
 * источник. Действия строки — история, правка, удаление.
 */
import type { ManualOperationRow } from '../accounting.domain';

import { History, Pencil, Plus, Trash2 } from 'lucide-vue-next';

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

defineProps<{ rows: ManualOperationRow[]; disabled: boolean }>();
const emit = defineEmits<{
  create: [];
  edit: [id: string];
  remove: [id: string];
  history: [id: string];
}>();
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-base font-semibold">Ручные операции</h2>
        <p class="text-sm text-muted-foreground">
          Начисления, которых нет в API и файлах площадок. «Финансы» их не учитывают.
        </p>
      </div>
      <Button :disabled="disabled" @click="emit('create')">
        <Plus aria-hidden="true" />
        Внести операцию
      </Button>
    </div>

    <Card v-if="!rows.length" class="text-sm text-muted-foreground"> Ручных операций нет. </Card>
    <Card v-else class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Дата</TableHead>
            <TableHead>Статья</TableHead>
            <TableHead class="hidden md:table-cell">Источник</TableHead>
            <TableHead class="text-right">Сумма</TableHead>
            <TableHead class="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in rows" :key="row.id">
            <TableCell class="whitespace-nowrap">
              <div class="tabular-nums">{{ row.dayLabel }}</div>
              <div class="text-xs text-muted-foreground">{{ row.marketplaceLabel }}</div>
            </TableCell>
            <TableCell>
              <div>{{ row.articleLabel }}</div>
              <div v-if="row.refLabel" class="text-xs text-muted-foreground">
                {{ row.refLabel }}
              </div>
            </TableCell>
            <TableCell class="hidden md:table-cell">{{ row.sourceLabel }}</TableCell>
            <TableCell
              class="text-right tabular-nums whitespace-nowrap"
              :class="row.income ? 'text-ok' : ''"
            >
              {{ row.amountLabel }}
            </TableCell>
            <TableCell>
              <div class="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="История изменений"
                  :disabled="disabled"
                  @click="emit('history', row.id)"
                >
                  <History aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Изменить"
                  :disabled="disabled"
                  @click="emit('edit', row.id)"
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Удалить"
                  :disabled="disabled"
                  @click="emit('remove', row.id)"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  </section>
</template>
