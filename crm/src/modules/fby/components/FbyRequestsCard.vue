<script setup lang="ts">
/**
 * Заявки на вывоз и утилизацию — в порядке бота: что готово забрать, сверху.
 * Сбой источника — предупреждение, не пустая таблица.
 */
import type { FbyRequest } from '../fby.domain';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount } from '@/shared/utils';

defineProps<{ requests: readonly FbyRequest[] | null; problem: string | null }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>
        Заявки на вывоз и утилизацию<template v-if="requests">
          · {{ formatCount(requests.length) }}</template
        >
      </CardTitle>
    </CardHeader>

    <CardContent v-if="!requests">
      <Alert variant="warn">{{ problem }}</Alert>
    </CardContent>

    <Table v-else class="border-t">
      <TableHeader>
        <TableRow>
          <TableHead>Заявка</TableHead>
          <TableHead>Тип</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead class="text-right">Брак</TableHead>
          <TableHead class="hidden md:table-cell">Склад</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in requests" :key="row.id">
          <TableCell class="tnum font-medium">№{{ row.id }}</TableCell>
          <TableCell>{{ row.typeLabel }}</TableCell>
          <TableCell>
            <Badge v-if="row.ready" variant="warn">{{ row.statusLabel }}</Badge>
            <template v-else>{{ row.statusLabel }}</template>
          </TableCell>
          <TableCell class="tnum text-right">
            {{ row.defectCount ? formatCount(row.defectCount) : '—' }}
          </TableCell>
          <TableCell class="hidden text-muted-foreground md:table-cell">
            {{ row.targetName ?? '—' }}
          </TableCell>
        </TableRow>
        <TableRow v-if="requests.length === 0">
          <TableCell colspan="5" class="py-8 text-center text-muted-foreground">
            Активных заявок нет.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
