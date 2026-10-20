<script setup lang="ts">
/**
 * What-if «комиссия ±N п.п.» (решение `forecast_whatif_block`): поле поправки и
 * чистая месяца до и после. Пересчёт — `whatIfOf` в маппере, здесь только ввод
 * и вывод; расчёт на штуку — ссылкой в калькулятор цены.
 */
import type { WhatIfView } from '../forecast.domain';

import { Calculator } from 'lucide-vue-next';

import { PRICE_CALCULATOR_ROUTE } from '../forecast.domain';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatKopecks } from '@/shared/utils';

defineProps<{ view: WhatIfView; withCalculator: boolean }>();
const emit = defineEmits<{ change: [string | number | undefined] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Что если комиссия изменится</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-col gap-3 text-sm">
      <label class="flex items-center gap-2">
        <span>Комиссия</span>
        <Input
          :model-value="String(view.deltaPp)"
          type="number"
          step="0.5"
          class="h-9 w-24"
          aria-label="Изменение комиссии, п.п."
          @update:model-value="emit('change', $event)"
        />
        <span class="text-muted-foreground">п.п. на оставшиеся дни</span>
      </label>
      <p>
        Чистая месяца:
        <span class="tnum">{{ view.netBefore }}</span>
        →
        <span class="tnum font-semibold">{{ view.netAfter }}</span>
        <Badge variant="outline" class="ml-1">прогноз</Badge>
      </p>
      <p class="text-xs text-muted-foreground">
        Комиссия {{ formatKopecks(view.commissionKopecks) }}, налог
        {{ formatKopecks(view.taxKopecks) }}. {{ view.note }}
      </p>
      <RouterLink
        v-if="withCalculator"
        :to="{ name: PRICE_CALCULATOR_ROUTE }"
        class="inline-flex items-center gap-1.5 text-link underline"
      >
        <Calculator class="size-4" />
        На штуку — в калькуляторе цены
      </RouterLink>
    </CardContent>
  </Card>
</template>
