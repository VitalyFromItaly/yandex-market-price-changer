<script setup lang="ts">
/**
 * Уровни прибыли месяца: выручка → валовая → после площадки → операционная →
 * чистая. Статус периода и пояснения — над итогом: непроверенный месяц может
 * поменяться, и это должно читаться раньше числа.
 */
import type { PnlModel } from '../finance.domain';

import { Info } from 'lucide-vue-next';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{ model: PnlModel }>();
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Прибыль по журналу Маркета</CardTitle>
        <Badge :variant="model.tone">{{ model.statusLabel }}</Badge>
      </div>
      <CardDescription>
        {{ model.rangeLabel }} · по дате начисления
        <template v-if="model.preliminary">
          · числа могут измениться, пока месяц не проверен</template
        >
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4 text-sm">
      <dl class="grid gap-1">
        <div
          v-for="row in model.levels"
          :key="row.key"
          class="flex justify-between gap-4"
          :class="row.total ? 'font-medium' : 'pl-4'"
        >
          <dt :class="row.total ? '' : 'text-muted-foreground'">{{ row.label }}</dt>
          <dd class="tabular-nums" :class="row.negative && row.total ? 'text-danger' : ''">
            {{ row.amount }}
          </dd>
        </div>
      </dl>

      <div class="flex items-baseline justify-between gap-4 border-t pt-3">
        <span class="font-medium">Чистая прибыль</span>
        <span class="text-right">
          <span
            class="block text-2xl font-semibold tabular-nums"
            :class="model.netNegative ? 'text-danger' : ''"
          >
            {{ model.net }}
          </span>
          <span v-if="model.netMargin" class="text-xs text-muted-foreground">
            маржа {{ model.netMargin }}
          </span>
        </span>
      </div>

      <Alert v-for="note in model.notes" :key="note" variant="warn">
        <Info />
        <span>{{ note }}</span>
      </Alert>
    </CardContent>
  </Card>
</template>
