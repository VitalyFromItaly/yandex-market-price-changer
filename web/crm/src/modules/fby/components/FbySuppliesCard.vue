<script setup lang="ts">
/**
 * Входящие поставки (фича fby_supply) — активные, ближние к приёмке сверху.
 * Принятые и отменённые не перечисляются, но их число названо.
 */
import type { FbySupplies } from '../fby.domain';

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
import { formatCount } from '@/shared/utils';

defineProps<{ supplies: Exclude<FbySupplies, { state: 'off' }> }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>
        Поставки на склад Маркета<template v-if="supplies.state === 'ok'">
          · {{ formatCount(supplies.rows.length) }}</template
        >
      </CardTitle>
      <CardDescription v-if="supplies.state === 'ok' && supplies.terminal">
        Завершённых/отменённых: {{ formatCount(supplies.terminal) }}
      </CardDescription>
    </CardHeader>

    <CardContent v-if="supplies.state === 'error'">
      <Alert variant="warn">{{ supplies.text }}</Alert>
    </CardContent>

    <Table v-else class="border-t">
      <TableHeader>
        <TableRow>
          <TableHead>Поставка</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead class="text-right">Дата</TableHead>
          <TableHead class="hidden md:table-cell">Склад</TableHead>
          <TableHead class="text-right">План / факт</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in supplies.rows" :key="row.id">
          <TableCell class="tnum font-medium">№{{ row.id }}</TableCell>
          <TableCell>{{ row.statusLabel }}</TableCell>
          <TableCell class="tnum text-right">{{ row.date ?? '—' }}</TableCell>
          <TableCell class="hidden text-muted-foreground md:table-cell">
            {{ row.targetName ?? '—' }}
            <template v-if="row.transitName">, через «{{ row.transitName }}»</template>
          </TableCell>
          <TableCell class="tnum text-right">
            {{ row.planCount ? formatCount(row.planCount) : '—' }}
            <template v-if="row.factCount"> / {{ formatCount(row.factCount) }}</template>
          </TableCell>
        </TableRow>
        <TableRow v-if="supplies.rows.length === 0">
          <TableCell colspan="5" class="py-8 text-center text-muted-foreground">
            Активных поставок нет.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
