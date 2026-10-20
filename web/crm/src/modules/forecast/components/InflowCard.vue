<script setup lang="ts">
/**
 * Поступления до конца месяца: «к получению» сейчас плюс прогноз начислений
 * оставшихся дней. График выплат Маркета не моделируется — экран это говорит.
 */
import type { Forecast } from '../forecast.domain';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatKopecks } from '@/shared/utils';

defineProps<{ inflow: Forecast['inflow'] }>();
</script>

<template>
  <Card>
    <CardHeader class="flex flex-row items-center justify-between gap-2">
      <CardTitle>Поступления до конца месяца</CardTitle>
      <Badge variant="outline">прогноз</Badge>
    </CardHeader>
    <CardContent class="flex flex-col gap-2 text-sm">
      <span class="tnum text-2xl font-semibold">{{ formatKopecks(inflow.totalKopecks) }}</span>
      <dl class="flex flex-col gap-1 text-muted-foreground">
        <div class="flex justify-between gap-2">
          <dt>К получению сейчас</dt>
          <dd class="tnum">{{ formatKopecks(inflow.receivableKopecks) }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt>Начислит до конца месяца</dt>
          <dd class="tnum">{{ formatKopecks(inflow.accrualsKopecks) }}</dd>
        </div>
      </dl>
      <p class="text-xs text-muted-foreground">
        Сколько Маркет должен перечислить; график выплат не учтён — часть придёт в следующем месяце.
      </p>
    </CardContent>
  </Card>
</template>
