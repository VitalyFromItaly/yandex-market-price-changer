<script setup lang="ts">
/**
 * Год одним взглядом: доход с начала года, прогноз (помечен «прогноз»), налог к
 * уплате, уплачено, остаток и полосы до лимита УСН и порога НДС.
 */
import type { TaxLimitBar, TaxYearResponse } from '../taxes.domain';

import { computed } from 'vue';

import { formatRate } from '../mappers/mapTaxes.taxes';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatKopecks } from '@/shared/utils';

const props = defineProps<{ view: TaxYearResponse; limits: TaxLimitBar[] }>();

const due = computed(() => props.view.periods[props.view.periods.length - 1]?.dueKopecks ?? 0);
const balanceLabel = computed(() =>
  props.view.balanceKopecks < 0 ? 'Переплата' : 'Осталось уплатить',
);

const BAR_CLASS: Record<TaxLimitBar['tone'], string> = {
  ok: 'bg-brand',
  warn: 'bg-warn',
  danger: 'bg-danger',
};
const width = (share: number | null) => `${Math.min(Math.max(share ?? 0, 0), 1) * 100}%`;
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ view.closed ? `Итоги ${view.year} года` : `${view.year} год` }}</CardTitle>
      <CardDescription>
        {{ view.settings.regimeLabel }} · {{ formatRate(view.settings.rateBasisPoints) }} % ·
        {{ view.settings.recognitionLabel.toLowerCase() }}
        <template v-if="view.taxIsDefault"> · по умолчанию</template>
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-6">
      <dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="flex flex-col gap-1">
          <dt class="text-sm text-muted-foreground">Доход с начала года</dt>
          <dd class="text-2xl font-semibold tabular-nums">
            {{ formatKopecks(view.incomeKopecks) }}
          </dd>
          <dd class="text-xs text-muted-foreground">до комиссий площадки</dd>
        </div>
        <div v-if="view.forecast" class="flex flex-col gap-1">
          <dt class="flex items-center gap-2 text-sm text-muted-foreground">
            Доход за год
            <Badge variant="outline">прогноз</Badge>
          </dt>
          <dd class="text-2xl font-semibold tabular-nums">
            {{ formatKopecks(view.forecast.incomeKopecks) }}
          </dd>
          <dd class="text-xs text-muted-foreground">
            по {{ view.forecast.basisDays }} дням, без сезонности
          </dd>
        </div>
        <div class="flex flex-col gap-1">
          <dt class="text-sm text-muted-foreground">Налог к уплате</dt>
          <dd class="text-2xl font-semibold tabular-nums">{{ formatKopecks(due) }}</dd>
          <dd class="text-xs text-muted-foreground">
            уплачено {{ formatKopecks(view.paidKopecks) }}
          </dd>
        </div>
        <div class="flex flex-col gap-1">
          <dt class="text-sm text-muted-foreground">{{ balanceLabel }}</dt>
          <dd class="text-2xl font-semibold tabular-nums">
            {{ formatKopecks(Math.abs(view.balanceKopecks)) }}
          </dd>
          <dd class="text-xs text-muted-foreground">уплаты — в разделе «Закупки»</dd>
        </div>
      </dl>

      <div class="grid gap-4 sm:grid-cols-2">
        <div v-for="limit in limits" :key="limit.key" class="flex flex-col gap-2">
          <div class="flex items-baseline justify-between gap-2 text-sm">
            <span>{{ limit.label }}</span>
            <span class="tabular-nums text-muted-foreground">{{ limit.value ?? 'не задан' }}</span>
          </div>
          <div
            v-if="limit.share !== null"
            class="h-2 overflow-hidden rounded-full bg-secondary"
            role="meter"
            :aria-label="limit.label"
            :aria-valuenow="Math.round(limit.share * 100)"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              :class="cn('h-full rounded-full', BAR_CLASS[limit.tone])"
              :style="{ width: width(limit.share) }"
            />
          </div>
          <span v-if="limit.share !== null" class="text-xs text-muted-foreground tabular-nums">
            {{ Math.floor(limit.share * 100) }} % дохода
            <template v-if="limit.forecastShare !== null">
              · по прогнозу {{ Math.floor(limit.forecastShare * 100) }} %
            </template>
          </span>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
