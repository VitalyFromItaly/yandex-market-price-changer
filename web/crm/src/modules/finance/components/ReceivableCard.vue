<script setup lang="ts">
/**
 * Деньги к получению: Маркет начислил, но ещё не выплатил. На сегодня, а не
 * на конец периода — это вопрос текущего момента.
 */
import type { CashflowModel } from '../finance.domain';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{ receivable: CashflowModel['receivable'] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Деньги к получению</CardTitle>
      <CardDescription
        >Начислено Маркетом, но ещё не выплачено — на {{ receivable.asOf }}</CardDescription
      >
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      <div class="text-3xl font-semibold tabular-nums">{{ receivable.total }}</div>
      <p v-if="receivable.isEmpty" class="text-sm text-muted-foreground">
        Невыплаченных начислений нет.
      </p>
      <dl v-else class="grid gap-1 text-sm">
        <div v-for="row in receivable.byArticle" :key="row.key" class="flex justify-between gap-4">
          <dt class="text-muted-foreground">{{ row.label }}</dt>
          <dd class="tabular-nums">{{ row.amount }}</dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</template>
