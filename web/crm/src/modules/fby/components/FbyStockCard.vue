<script setup lang="ts">
/**
 * Остатки на складе Маркета по кластерам-территориям, склады — под кластером.
 * Колонки — только типы, где что-то есть («доступно» всегда). Суммы кластеров
 * посчитаны сервером той же функцией, что строки бота.
 */
import type { FbyReport } from '../fby.domain';

import { Info } from 'lucide-vue-next';

import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { formatCount } from '@/shared/utils';

defineProps<{ report: FbyReport }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-1.5">
        Остатки на складе Маркета
        <Tooltip :text="report.stockHint">
          <button type="button" class="text-muted-foreground" aria-label="Что значат типы остатков">
            <Info class="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </CardTitle>
      <CardDescription v-if="report.stockHeading">{{ report.stockHeading }}</CardDescription>
    </CardHeader>

    <CardContent v-if="!report.stock">
      <Alert variant="warn">{{ report.stockProblem }}</Alert>
    </CardContent>

    <Table v-else class="border-t">
      <TableHeader>
        <TableRow>
          <TableHead>Кластер / склад</TableHead>
          <TableHead v-for="column in report.stock.columns" :key="column.type" class="text-right">
            {{ column.label }}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in report.stock.rows" :key="row.id">
          <TableCell :class="row.nested ? 'pl-8 text-muted-foreground' : 'font-medium'">
            {{ row.title }}
          </TableCell>
          <TableCell
            v-for="column in report.stock.columns"
            :key="column.type"
            class="tnum text-right"
            :class="row.nested ? 'text-muted-foreground' : ''"
          >
            {{ row.totals[column.type] ? formatCount(row.totals[column.type]) : '—' }}
          </TableCell>
        </TableRow>
        <TableRow class="font-medium">
          <TableCell>Итого</TableCell>
          <TableCell
            v-for="column in report.stock.columns"
            :key="column.type"
            class="tnum text-right"
          >
            {{ formatCount(report.stock.totals[column.type]) }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
