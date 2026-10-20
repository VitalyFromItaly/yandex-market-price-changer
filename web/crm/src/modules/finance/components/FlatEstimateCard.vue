<script setup lang="ts">
/**
 * Плоская оценка «Прибыли» рядом с непроверенным текущим месяцем: Маркет
 * журнал ещё дописывает, а продавцу нужна цифра сегодня. Подписана
 * «предварительно» — это формула ставок, а не журнал (finance_actual_beside_flat).
 */
import type { PnlModel } from '../finance.domain';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{ flat: NonNullable<PnlModel['flat']> }>();
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Оценка по ставкам</CardTitle>
        <Badge variant="warn">предварительно</Badge>
      </div>
      <CardDescription>
        {{ flat.label }}: формула «Прибыли» по ставкам из «Настроек», пока журнал месяца не проверен
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-3 text-sm">
      <dl class="grid gap-1">
        <div v-for="row in flat.rows" :key="row.key" class="flex justify-between gap-4">
          <dt class="text-muted-foreground">{{ row.label }}</dt>
          <dd class="tabular-nums">{{ row.amount }}</dd>
        </div>
      </dl>
      <div class="flex items-baseline justify-between gap-4 border-t pt-3 font-medium">
        <span>Чистая — предварительно</span>
        <span class="tabular-nums">{{ flat.net }}</span>
      </div>
    </CardContent>
  </Card>
</template>
