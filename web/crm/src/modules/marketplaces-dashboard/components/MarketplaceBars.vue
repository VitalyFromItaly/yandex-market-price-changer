<script setup lang="ts">
/**
 * Один показатель по площадкам за период — столбиками рядом. Заголовок ведёт в
 * «Сравнение площадок»: там тот же показатель строкой таблицы.
 */
import type { BarPoint } from '@/components/ui/chart';
import type { RouteLocationRaw } from 'vue-router';

import { RouterLink } from 'vue-router';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart } from '@/components/ui/chart';

defineProps<{
  title: string;
  label: string;
  points: BarPoint[];
  format: (value: number) => string;
  to: RouteLocationRaw;
}>();
</script>

<template>
  <Card>
    <CardHeader class="pb-2">
      <CardTitle class="text-base">
        <RouterLink :to="to" class="hover:underline">{{ title }}</RouterLink>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <BarChart
        v-if="points.length"
        :points="points"
        :label="label"
        :format="format"
        :height="200"
      />
      <p v-else class="text-sm text-muted-foreground">
        Показатель не посчитан ни у одной площадки.
      </p>
    </CardContent>
  </Card>
</template>
