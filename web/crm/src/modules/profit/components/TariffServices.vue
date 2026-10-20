<script setup lang="ts">
/**
 * Услуги Маркета по видам — по убыванию, как у бота. Сумма строк равна
 * «Услугам Маркета» в столбце вычитаний по построению сервиса.
 * Полоса под названием — масштаб от самой дорогой услуги, доля — от всех услуг:
 * сразу видно, какая услуга съедает больше всего.
 */
import type { ServiceRow } from '../profit.domain';

import { computed } from 'vue';

import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { DataBar, formatShare } from '@/components/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatRub } from '@/shared/utils';

const props = defineProps<{ services: readonly ServiceRow[] }>();

const max = computed(() => Math.max(0, ...props.services.map((s) => s.sum)));
const total = computed(() => props.services.reduce((sum, s) => sum + s.sum, 0));
</script>

<template>
  <Card class="p-0">
    <CardHeader>
      <CardTitle>Услуги Маркета по видам</CardTitle>
    </CardHeader>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Услуга</TableHead>
          <TableHead class="text-right">Доля</TableHead>
          <TableHead class="text-right">Сумма</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="service in services" :key="service.type">
          <TableCell class="min-w-40">
            <span class="block">{{ service.label }}</span>
            <DataBar :value="service.sum" :max="max" tone="brand" class="mt-1.5 h-1" />
          </TableCell>
          <TableCell class="tnum text-right text-muted-foreground">
            {{ formatShare(service.sum, total) }}
          </TableCell>
          <TableCell class="tnum text-right">{{ formatRub(service.sum) }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
