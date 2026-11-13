<script setup lang="ts">
/**
 * Документы месяца (TASK-228): акты (итог отчёта об услугах против строк дня
 * акта) и платёжные поручения (выплаты — движение денег, не прибыль).
 */
import type { ReconcileDocumentRow } from '../accounting.domain';

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

defineProps<{ rows: ReconcileDocumentRow[]; title: string; empty: string }>();
</script>

<template>
  <section class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold">{{ title }}</h3>
    <Card v-if="!rows.length" class="p-4 text-sm text-muted-foreground">{{ empty }}</Card>
    <Card v-else class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Документ</TableHead>
            <TableHead class="text-right">Реестр</TableHead>
            <TableHead class="text-right">Документ</TableHead>
            <TableHead class="text-right">Разница</TableHead>
            <TableHead>Статус</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in rows" :key="row.key">
            <TableCell>
              <div class="font-medium">{{ row.title }}</div>
              <div v-if="row.note" class="text-xs text-muted-foreground">{{ row.note }}</div>
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              {{ row.registryLabel }}
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              {{ row.documentLabel }}
            </TableCell>
            <TableCell
              class="whitespace-nowrap text-right tabular-nums"
              :class="row.tone === 'danger' ? 'text-danger' : ''"
            >
              {{ row.differenceLabel }}
            </TableCell>
            <TableCell
              ><Badge :variant="row.tone">{{ row.statusLabel }}</Badge></TableCell
            >
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  </section>
</template>
