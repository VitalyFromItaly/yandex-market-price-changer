<script setup lang="ts">
/**
 * Выручка или заказы площадок во времени — по ряду на площадку, одна ось.
 * Ряд — тот же журнал, что у «Аналитики продаж» площадки, поэтому сумма точек
 * площадки = её выручке в карточке. Прибыли во времени нет: в журнале её по
 * дням нет, она — за период, столбиками ниже.
 */
import type { DashboardMetric } from '../marketplaces-dashboard.domain';
import type { AreaPoint, AreaSeries } from '@/components/ui/chart';

import { DASHBOARD_METRIC_OPTIONS } from '../marketplaces-dashboard.domain';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart } from '@/components/ui/chart';
import { OptionGroup } from '@/components/ui/option-group';
import { formatCount, formatRub } from '@/shared/utils';

defineProps<{ points: AreaPoint[]; series: AreaSeries[]; metric: DashboardMetric }>();
defineEmits<{ metric: [DashboardMetric] }>();

const SHORT = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const axisFormat = (value: number): string => SHORT.format(value);
</script>

<template>
  <Card>
    <CardHeader class="flex-row flex-wrap items-center justify-between gap-3 pb-2">
      <CardTitle class="text-base">
        {{ metric === 'revenue' ? 'Выручка по площадкам' : 'Заказы по площадкам' }}
      </CardTitle>
      <OptionGroup
        :model-value="metric"
        :options="DASHBOARD_METRIC_OPTIONS"
        label="Показатель графика"
        @update:model-value="$emit('metric', $event)"
      />
    </CardHeader>
    <CardContent>
      <AreaChart
        :points="points"
        :series="series"
        :format="metric === 'revenue' ? formatRub : formatCount"
        :axis-format="axisFormat"
        :label="metric === 'revenue' ? 'Выручка площадок во времени' : 'Заказы площадок во времени'"
      />
    </CardContent>
  </Card>
</template>
