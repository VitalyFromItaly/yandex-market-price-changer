<script setup lang="ts">
/**
 * Ряд отчёта по дням — над таблицей. Отвечает на вопрос, которого нет в
 * итогах: ровно ли шло или был провал/всплеск. Клик по дню фильтрует таблицу
 * под ним (повторный — снимает); выбор живёт на странице.
 */
import type { DayPoint } from '../mappers/ordersByDay.orders';
import type { BarPoint } from '@/components/ui/chart';

import { computed, ref } from 'vue';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart } from '@/components/ui/chart';
import { OptionGroup } from '@/components/ui/option-group';
import { formatCount, formatRub } from '@/shared/utils';

const props = defineProps<{
  points: readonly DayPoint[];
  clipped: number;
  selected: string | null;
}>();
const emit = defineEmits<{ select: [string | null] }>();

type Metric = 'count' | 'sales';
const METRICS = [
  { value: 'count', label: 'Заказы' },
  { value: 'sales', label: 'Продажи' },
] as const;
const metric = ref<Metric>('count');

const SHORT = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

const bars = computed<BarPoint[]>(() =>
  props.points.map((p) => ({
    key: p.key,
    label: p.label,
    value: metric.value === 'count' ? p.count : p.sales,
    hint: `${formatCount(p.count)} шт. · ${formatRub(p.sales)}`,
  })),
);
const format = computed(() => (metric.value === 'count' ? formatCount : formatRub));
const axisFormat = (value: number): string => SHORT.format(value);
</script>

<template>
  <Card>
    <CardHeader class="flex-row flex-wrap items-center justify-between gap-3 pb-2">
      <CardTitle class="text-base">По дням</CardTitle>
      <OptionGroup v-model="metric" :options="METRICS" label="Что показать на графике" />
    </CardHeader>
    <CardContent class="flex flex-col gap-2">
      <BarChart
        :points="bars"
        :format="format"
        :axis-format="axisFormat"
        label="Отчёт по дням"
        selectable
        :selected="selected"
        @select="emit('select', $event)"
      />
      <p class="text-xs text-muted-foreground">
        Нажмите на день, чтобы оставить в таблице только его.
        <template v-if="clipped"
          >Показаны последние {{ formatCount(points.length) }} дней.</template
        >
      </p>
    </CardContent>
  </Card>
</template>
