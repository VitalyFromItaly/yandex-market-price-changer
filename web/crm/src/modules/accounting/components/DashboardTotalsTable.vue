<script setup lang="ts">
/**
 * Итоги панели «Финучёта» (TASK-231): строка × площадка (и «Все площадки», если её
 * собрал сервер). Ячейка строки с суммами — кнопка раскрытия до операций; оценка
 * (есть ожидаемое) и неизвестное помечены, неизвестное — словом, не нулём.
 */
import type { AccountingDashboardView, DashboardCell } from '../accounting.domain';

import { Info } from 'lucide-vue-next';

import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';

defineProps<{ view: AccountingDashboardView }>();
const emit = defineEmits<{ drill: [DashboardCell] }>();

const NUM = 'whitespace-nowrap text-right tabular-nums';
const STATE_CLASS: Record<DashboardCell['state'], string> = {
  fact: '',
  estimate: 'text-warn',
  unknown: 'text-muted-foreground italic',
};
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{{ view.periodLabel }}</TableHead>
          <TableHead v-for="column in view.columns" :key="column.block" :class="NUM">
            <span class="inline-flex items-center gap-1">
              {{ column.label }}
              <Tooltip v-if="column.note" :text="column.note">
                <button
                  type="button"
                  class="text-muted-foreground"
                  :aria-label="`Что не вошло: ${column.label}`"
                >
                  <Info class="size-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="row in view.rows"
          :key="row.key"
          :class="{ 'border-t-2': row.key === 'gross' }"
        >
          <TableCell :class="{ 'font-medium': row.total }">
            <span class="inline-flex items-center gap-1.5">
              {{ row.title }}
              <Tooltip v-if="row.hint" :text="row.hint">
                <button
                  type="button"
                  class="text-muted-foreground"
                  :aria-label="`Что входит: ${row.title}`"
                >
                  <Info class="size-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            </span>
          </TableCell>
          <TableCell
            v-for="cell in row.cells"
            :key="cell.block"
            :class="[NUM, { 'font-medium': row.total }]"
          >
            <Tooltip v-if="cell.note" :text="cell.note">
              <button
                v-if="cell.line"
                type="button"
                :class="['underline decoration-dotted underline-offset-4', STATE_CLASS[cell.state]]"
                :aria-label="`Раскрыть: ${row.title}, ${cell.text}`"
                @click="emit('drill', cell)"
              >
                {{ cell.text }}<span v-if="cell.state === 'estimate'" aria-hidden="true">*</span>
              </button>
              <span v-else tabindex="0" :class="STATE_CLASS[cell.state]">
                {{ cell.text }}<span v-if="cell.state === 'estimate'" aria-hidden="true">*</span>
              </span>
            </Tooltip>
            <button
              v-else-if="cell.line"
              type="button"
              class="hover:underline hover:decoration-dotted hover:underline-offset-4"
              :aria-label="`Раскрыть: ${row.title}, ${cell.text}`"
              @click="emit('drill', cell)"
            >
              {{ cell.text }}
            </button>
            <span v-else :class="STATE_CLASS[cell.state]">{{ cell.text }}</span>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
