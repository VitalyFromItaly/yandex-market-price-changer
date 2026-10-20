<script setup lang="ts">
/**
 * Таблица ТЗ п.2: показатели строками, площадки колонками. Ячейка — ссылка в
 * «Прибыль» своей площадки за тот же период; колонка без чисел (фича закрыта
 * или журнала нет) приглушена и говорит причину в шапке, а не нулями.
 */
import type { CompareRow } from '../mappers/mapCompare.marketplace-compare';
import type { CompareColumn } from '../marketplace-compare.domain';

import { statusTone } from '../mappers/mapCompare.marketplace-compare';

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

defineProps<{ columns: readonly CompareColumn[]; rows: readonly CompareRow[] }>();
</script>

<template>
  <Card class="overflow-x-auto p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="min-w-48">Показатель</TableHead>
          <TableHead
            v-for="column in columns"
            :key="column.marketplace"
            class="min-w-40 text-right align-top"
            :class="column.state === 'ok' ? '' : 'text-muted-foreground'"
          >
            <div class="flex flex-col items-end gap-1 py-1">
              <span class="font-medium text-foreground">{{ column.label }}</span>
              <Badge v-if="column.statusLabel" :variant="statusTone(column.status)">
                {{ column.statusLabel }}
              </Badge>
              <span v-if="column.reason" class="max-w-48 text-xs font-normal whitespace-normal">
                {{ column.reason }}
              </span>
              <span
                v-else-if="column.metrics && !column.metrics.costComplete"
                class="text-xs font-normal text-warn"
              >
                закуп известен не по всем продажам
              </span>
            </div>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.key">
          <TableCell :class="row.strong ? 'font-medium' : 'text-muted-foreground'">
            {{ row.label }}
          </TableCell>
          <TableCell
            v-for="cell in row.cells"
            :key="cell.marketplace"
            class="tnum text-right"
            :class="row.strong ? 'font-medium' : ''"
          >
            <RouterLink
              v-if="cell.to"
              :to="cell.to"
              class="hover:underline"
              :title="'Открыть в «Финансах» площадки'"
            >
              {{ cell.text }}
            </RouterLink>
            <span v-else class="text-muted-foreground">{{ cell.text }}</span>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
