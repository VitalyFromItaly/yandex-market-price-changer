<script setup lang="ts">
/**
 * Склады Маркета с остатками. «пусто» — отчёт есть, на складе ноль; «нет в
 * списке» — склад знает только отчёт. «Итого» — сумма показанных сервером
 * строк, та же, что у бота; фильтр её не пересчитывает.
 */
import type { WarehousesReport } from '../warehouses.domain';

import { Search } from 'lucide-vue-next';
import { computed, ref } from 'vue';

import { filterWarehouses } from '../mappers/warehousesTable.warehouses';
import { WAREHOUSES_FILTERS } from '../warehouses.domain';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount } from '@/shared/utils';

const props = defineProps<{ report: WarehousesReport }>();

const query = ref('');
const filter = ref<(typeof WAREHOUSES_FILTERS)[number]['value']>('all');
const visible = computed(() => filterWarehouses(props.report.rows, query.value, filter.value));
const columnCount = computed(() => props.report.columns.length + 2);
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Склады Маркета (FBY) · {{ formatCount(report.rows.length) }}</CardTitle>
      <CardDescription>
        {{ report.fbyHint
        }}<template v-if="report.stockHeading"> {{ report.stockHeading }}.</template>
      </CardDescription>
    </CardHeader>

    <CardContent v-if="report.stockProblem || report.rows.length" class="flex flex-col gap-3">
      <Alert v-if="report.stockProblem" variant="warn">{{ report.stockProblem }}</Alert>
      <div v-if="report.rows.length" class="flex flex-wrap items-center gap-3">
        <div class="relative w-full max-w-sm">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            v-model="query"
            type="search"
            class="pl-9"
            placeholder="Склад или адрес"
            aria-label="Поиск склада"
          />
        </div>
        <OptionGroup
          v-if="report.sum"
          v-model="filter"
          :options="WAREHOUSES_FILTERS"
          label="Остатки"
        />
      </div>
    </CardContent>

    <Table class="border-t">
      <TableHeader>
        <TableRow>
          <TableHead>Склад</TableHead>
          <TableHead class="hidden md:table-cell">Адрес</TableHead>
          <TableHead v-for="column in report.columns" :key="column.type" class="text-right">
            {{ column.label }}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in visible" :key="row.key">
          <TableCell>
            <span class="font-medium">{{ row.name }}</span>
            <Badge v-if="row.origin === 'report-only'" variant="warn" class="ml-2">
              {{ report.notInListLabel }}
            </Badge>
            <Badge v-else-if="row.totals && row.count === 0" variant="outline" class="ml-2">
              пусто
            </Badge>
          </TableCell>
          <TableCell class="hidden text-muted-foreground md:table-cell">
            {{ row.address ?? '—' }}
          </TableCell>
          <TableCell v-for="column in report.columns" :key="column.type" class="tnum text-right">
            {{ row.totals?.[column.type] ? formatCount(row.totals[column.type]) : '—' }}
          </TableCell>
        </TableRow>
        <TableRow v-if="visible.length === 0">
          <TableCell :colspan="columnCount" class="py-8 text-center text-muted-foreground">
            {{
              report.rows.length
                ? 'Ничего не нашлось — измените запрос или фильтр.'
                : 'Складов Маркета нет.'
            }}
          </TableCell>
        </TableRow>
        <TableRow v-if="report.sum && report.rows.length" class="font-medium">
          <TableCell>Итого</TableCell>
          <TableCell class="hidden md:table-cell" />
          <TableCell v-for="column in report.columns" :key="column.type" class="tnum text-right">
            {{ formatCount(report.sum[column.type]) }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
