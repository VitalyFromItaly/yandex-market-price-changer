<script setup lang="ts">
/**
 * Проблемные позиции (брак/просрочка/утиль) — полным списком, худшие сверху,
 * с поиском. Бот печатает до 30, остальное — в файле; здесь место есть.
 */
import type { FbyProblem } from '../fby.domain';

import { Search } from 'lucide-vue-next';
import { computed, ref } from 'vue';

import { filterProblems } from '../mappers/problemsTable.fby';

import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount } from '@/shared/utils';

const props = defineProps<{ problems: readonly FbyProblem[] }>();

const query = ref('');
const visible = computed(() => filterProblems(props.problems, query.value));

function count(value: number): string {
  return value ? formatCount(value) : '—';
}
</script>

<template>
  <Card>
    <CardHeader class="gap-3 sm:flex-row sm:items-center sm:justify-between">
      <CardTitle>Проблемные позиции · {{ formatCount(problems.length) }}</CardTitle>
      <div v-if="problems.length" class="relative w-full max-w-xs">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          v-model="query"
          type="search"
          class="pl-9"
          placeholder="Артикул или название"
          aria-label="Поиск проблемной позиции"
        />
      </div>
    </CardHeader>
    <Table class="border-t">
      <TableHeader>
        <TableRow>
          <TableHead>Артикул</TableHead>
          <TableHead class="hidden md:table-cell">Товар</TableHead>
          <TableHead class="text-right">Брак</TableHead>
          <TableHead class="text-right">Просрочка</TableHead>
          <TableHead class="text-right">Утиль</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in visible" :key="row.sku">
          <TableCell class="font-medium">{{ row.sku }}</TableCell>
          <TableCell class="hidden text-muted-foreground md:table-cell">{{ row.name }}</TableCell>
          <TableCell class="tnum text-right">{{ count(row.defect) }}</TableCell>
          <TableCell class="tnum text-right">{{ count(row.expired) }}</TableCell>
          <TableCell class="tnum text-right">{{ count(row.utilization) }}</TableCell>
        </TableRow>
        <TableRow v-if="visible.length === 0">
          <TableCell colspan="5" class="py-8 text-center text-muted-foreground">
            {{
              problems.length ? 'Ничего не нашлось — измените запрос.' : 'Проблемных позиций нет.'
            }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
