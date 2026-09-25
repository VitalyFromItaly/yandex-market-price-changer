<script setup lang="ts">
/**
 * Ключевые числа сводки — те же, что бот печатает строками: доступно к заказу,
 * «Едет до клиента», «Едет обратно», проблемные позиции. Недоступный источник —
 * «—», а не ноль.
 */
import type { FbyReport } from '../fby.domain';

import { Card, CardContent } from '@/components/ui/card';
import { formatCount } from '@/shared/utils';

const props = defineProps<{ report: FbyReport }>();

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : formatCount(value);
}

const tiles = [
  { label: 'Доступно к заказу', value: () => props.report.stock?.totals.AVAILABLE },
  { label: 'Едет до клиента', value: () => props.report.inTransit },
  { label: 'Едет обратно', value: () => props.report.returning },
  { label: 'Проблемных позиций', value: () => props.report.stock?.problems.length },
];
</script>

<template>
  <Card>
    <CardContent class="pt-5">
      <dl class="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <div v-for="tile in tiles" :key="tile.label">
          <dt class="text-sm text-muted-foreground">{{ tile.label }}</dt>
          <dd class="tnum mt-1 text-2xl font-semibold">{{ count(tile.value()) }}</dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</template>
