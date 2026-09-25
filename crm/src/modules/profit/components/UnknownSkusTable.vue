<script setup lang="ts">
/**
 * Заказы, выпавшие из расчёта, и артикулы, из-за которых они выпали. Список
 * полный (бот печатает пять) — продавцу грузить их одним прайсом, поэтому
 * рядом переход к загрузке, если раздел «Прайс» ему открыт.
 */
import type { Excluded } from '../profit.domain';

import { FileSpreadsheet } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatRub } from '@/shared/utils';

defineProps<{ excluded: Excluded; priceListOpen: boolean }>();
</script>

<template>
  <Card class="p-0">
    <CardHeader class="gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex flex-col gap-1">
        <CardTitle class="tnum text-warn">
          Не учтено заказов: {{ formatCount(excluded.orders) }} на
          {{ formatRub(excluded.revenue) }}
        </CardTitle>
        <CardDescription>
          Причина — {{ excluded.reason }}.
          <template v-if="excluded.advice">{{ excluded.advice }}</template>
        </CardDescription>
      </div>
      <Button v-if="priceListOpen" variant="outline" size="sm" as-child>
        <RouterLink :to="{ name: 'ym-price-list' }">
          <FileSpreadsheet />
          Загрузить прайс
        </RouterLink>
      </Button>
    </CardHeader>
    <div v-if="excluded.skus.length" class="max-h-96 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Артикул</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="sku in excluded.skus" :key="sku">
            <TableCell class="font-mono text-sm">{{ sku }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </Card>
</template>
