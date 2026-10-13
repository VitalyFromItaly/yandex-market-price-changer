<script setup lang="ts">
/**
 * «Выручка и чистая прибыль» по дням — под рядом KPI. Отвечает на то, чего нет
 * в итогах: ровно ли шёл период. Ряд — из того же результата «Прибыли», что
 * карточки, поэтому сумма точек = числам «Продажи» и «Чистая».
 */
import type { ProfitSeries } from '../mappers/mapKpis.dashboard';
import type { AreaSeries } from '@/components/ui/chart';
import type { RouteLocationRaw } from 'vue-router';

import { RotateCw } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import { PROFIT_SERIES } from '../mappers/mapKpis.dashboard';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart } from '@/components/ui/chart';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCount, formatRub } from '@/shared/utils';

defineProps<{
  series: ProfitSeries | null;
  heading?: string | null;
  to: RouteLocationRaw;
  isLoading?: boolean;
  isRefreshing?: boolean;
  savedAt?: string | null;
  error?: string | null;
  loadingText?: string;
}>();
defineEmits<{ retry: [] }>();

const SERIES: AreaSeries[] = [
  { key: PROFIT_SERIES.REVENUE, label: 'Выручка', tone: 'c1' },
  { key: PROFIT_SERIES.NET, label: 'Чистая прибыль', tone: 'ok' },
];

const SHORT = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const axisFormat = (value: number): string => SHORT.format(value);
</script>

<template>
  <Card>
    <CardHeader class="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-2">
      <div class="flex min-w-0 flex-col gap-0.5">
        <CardTitle class="text-base">
          <RouterLink :to="to" class="hover:underline">Выручка и чистая прибыль</RouterLink>
        </CardTitle>
        <p v-if="heading" class="text-xs text-muted-foreground">{{ heading }}</p>
      </div>
    </CardHeader>
    <CardContent class="flex flex-col gap-2">
      <div v-if="error && series === null" class="flex flex-col items-start gap-2">
        <p class="text-sm text-danger">{{ error }}</p>
        <Button variant="ghost" size="sm" @click="$emit('retry')">
          <RotateCw />
          Повторить
        </Button>
      </div>
      <div v-else-if="series === null" class="flex flex-col gap-2" aria-busy="true">
        <Skeleton class="h-[220px] w-full" />
        <p v-if="loadingText" class="text-xs text-muted-foreground">{{ loadingText }}</p>
      </div>
      <template v-else>
        <RefreshIndicator
          compact
          :refreshing="isRefreshing ?? false"
          :saved-at="savedAt ?? null"
          :error="error"
          @retry="$emit('retry')"
        />
        <AreaChart
          :points="series.points"
          :series="SERIES"
          :format="formatRub"
          :axis-format="axisFormat"
          label="Выручка и чистая прибыль по дням"
        />
        <p v-if="series.undated" class="text-xs text-muted-foreground">
          {{ formatCount(series.undated) }} заказ(ов) без даты в карточках учтены, на графике — нет.
        </p>
      </template>
    </CardContent>
  </Card>
</template>
