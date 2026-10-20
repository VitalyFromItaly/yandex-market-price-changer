<script setup lang="ts">
/** Склады отгрузки самого продавца (FBS/DBS/Экспресс) — остатков у них здесь нет. */
import type { StoreWarehouse } from '../warehouses.domain';

import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount } from '@/shared/utils';

defineProps<{ warehouses: readonly StoreWarehouse[]; hint: string }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Склады магазина · {{ formatCount(warehouses.length) }}</CardTitle>
      <CardDescription>{{ hint }}</CardDescription>
    </CardHeader>
    <Table class="border-t">
      <TableHeader>
        <TableRow>
          <TableHead>Склад</TableHead>
          <TableHead class="hidden md:table-cell">Адрес</TableHead>
          <TableHead class="hidden md:table-cell">Группа</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="warehouse in warehouses" :key="warehouse.id">
          <TableCell>
            <span class="font-medium">{{ warehouse.name }}</span>
            <Badge v-if="warehouse.express" variant="outline" class="ml-2">Экспресс</Badge>
          </TableCell>
          <TableCell class="hidden text-muted-foreground md:table-cell">
            {{ warehouse.address ?? '—' }}
          </TableCell>
          <TableCell class="hidden text-muted-foreground md:table-cell">
            {{ warehouse.groupName ?? '—' }}
          </TableCell>
        </TableRow>
        <TableRow v-if="warehouses.length === 0">
          <TableCell colspan="3" class="py-8 text-center text-muted-foreground">
            Своих складов нет.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
