<script setup lang="ts">
/**
 * Итог загрузки — в словах отчёта бота: заголовок, почему не записали, числа,
 * что делать дальше. Пропуски — таблицей целиком (бот печатает десять).
 */
import type { StockSyncResult } from '../price-list.domain';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatCount } from '@/shared/utils';

defineProps<{ result: StockSyncResult }>();
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card>
      <CardHeader>
        <CardTitle :class="cn(result.success && 'text-ok')">{{ result.headline }}</CardTitle>
        <CardDescription v-if="result.explanation">{{ result.explanation }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <dl class="flex flex-col">
          <div
            v-for="row in result.counts"
            :key="row.label"
            class="flex items-baseline justify-between gap-4 py-1.5"
          >
            <dt class="text-sm">{{ row.label }}</dt>
            <dd
              :class="
                cn(
                  'tnum shrink-0 text-right',
                  row.tone === 'warn' && 'text-warn',
                  row.tone === 'danger' && 'text-danger',
                )
              "
            >
              {{ formatCount(row.value) }}
            </dd>
          </div>
        </dl>
        <p v-if="result.pricesSkippedNote" class="text-sm text-muted-foreground">
          {{ result.pricesSkippedNote }}
        </p>
        <p v-if="result.advice" class="text-sm">{{ result.advice }}</p>
      </CardContent>
    </Card>

    <Card v-if="result.errors.length" class="p-0">
      <CardHeader>
        <CardTitle class="text-danger">Ошибки Маркета</CardTitle>
        <CardDescription>
          Эти позиции остались со старым остатком. Загрузите файл ещё раз.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Партия</TableHead>
            <TableHead class="text-right">Позиций</TableHead>
            <TableHead>Ответ Маркета</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="error in result.errors" :key="error.batch">
            <TableCell class="tnum">{{ error.batch }}</TableCell>
            <TableCell class="tnum text-right">{{ formatCount(error.count) }}</TableCell>
            <TableCell class="text-sm">{{ error.message }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <Card v-if="result.skipped.length" class="p-0">
      <CardHeader>
        <CardTitle class="tnum">Пропущено: {{ formatCount(result.skipped.length) }}</CardTitle>
        <CardDescription>
          Это позиции поставщика, которых нет в вашем каталоге на Маркете: в файле приходит весь его
          ассортимент, а он шире вашего. Заведите карточки на нужные — и они начнут обновляться.
        </CardDescription>
      </CardHeader>
      <div class="max-h-96 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="text-right">Строка</TableHead>
              <TableHead>Позиция</TableHead>
              <TableHead class="hidden md:table-cell">Категория</TableHead>
              <TableHead>Причина</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in result.skipped" :key="row.rowNumber">
              <TableCell class="tnum text-right text-muted-foreground">
                {{ row.rowNumber }}
              </TableCell>
              <TableCell class="font-mono text-sm">{{ row.name }}</TableCell>
              <TableCell class="hidden text-muted-foreground md:table-cell">
                {{ row.category }}
              </TableCell>
              <TableCell class="text-sm text-muted-foreground">{{ row.reason }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>
  </div>
</template>
