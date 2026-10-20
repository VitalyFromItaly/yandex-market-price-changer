<script setup lang="ts">
/**
 * Движение денег за период: что пришло (выплаты Маркета по дате поручения) и
 * что ушло (закупки, расходы, уплаченные налоги). Это не прибыль: прибыль —
 * по начислению, здесь — по деньгам.
 */
import type { CashflowModel } from '../finance.domain';

import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  model: CashflowModel | null;
  error: string | null;
  loading: boolean;
}>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Движение денег</CardTitle>
      <CardDescription>
        {{ model ? model.rangeLabel : 'Поступления и выбытия по дням оплаты' }}
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <Alert v-if="error">{{ error }}</Alert>
      <Skeleton v-else-if="!model" class="h-40 w-full" />
      <div v-else class="flex flex-col gap-4 text-sm" :aria-busy="loading">
        <dl class="grid gap-1">
          <div class="flex justify-between gap-4 font-medium">
            <dt>Поступления</dt>
            <dd class="tabular-nums text-ok">{{ model.inflowTotal }}</dd>
          </div>
          <div v-for="line in model.inflow" :key="line.key" class="flex justify-between gap-4 pl-4">
            <dt class="text-muted-foreground">{{ line.label }}</dt>
            <dd class="tabular-nums">{{ line.amount }}</dd>
          </div>
        </dl>

        <dl class="grid gap-1">
          <div class="flex justify-between gap-4 font-medium">
            <dt>Выбытия</dt>
            <dd class="tabular-nums">{{ model.outflowTotal }}</dd>
          </div>
          <template v-for="line in model.outflow" :key="line.key">
            <div class="flex justify-between gap-4 pl-4">
              <dt class="text-muted-foreground">{{ line.label }}</dt>
              <dd class="tabular-nums">{{ line.amount }}</dd>
            </div>
            <div
              v-for="child in line.children ?? []"
              :key="`${line.key}-${child.key}`"
              class="flex justify-between gap-4 pl-8 text-xs"
            >
              <dt class="text-muted-foreground">{{ child.label }}</dt>
              <dd class="tabular-nums text-muted-foreground">{{ child.amount }}</dd>
            </div>
          </template>
        </dl>

        <div class="flex items-baseline justify-between gap-4 border-t pt-3">
          <span class="font-medium">Итого за месяц</span>
          <span
            class="text-2xl font-semibold tabular-nums"
            :class="model.netNegative ? 'text-danger' : ''"
          >
            {{ model.net }}
          </span>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
