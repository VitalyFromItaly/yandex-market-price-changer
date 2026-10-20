<script setup lang="ts">
/**
 * Фактические выплаты Маркета за месяц — по платёжным поручениям. Пометка —
 * сумма строк журнала не сошлась с суммой поручения (подробности — в сверке).
 */
import type { CashflowModel } from '../finance.domain';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{ payouts: CashflowModel['payouts'] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Фактические выплаты</CardTitle>
      <CardDescription>Платёжные поручения Маркета за месяц</CardDescription>
    </CardHeader>
    <CardContent>
      <p v-if="payouts.length === 0" class="text-sm text-muted-foreground">
        В этот месяц выплат не было — или журнал за него ещё не загружен.
      </p>
      <ul v-else class="divide-y text-sm">
        <li v-for="payout in payouts" :key="payout.key" class="flex items-center gap-4 py-2">
          <span class="w-24 shrink-0 text-muted-foreground">{{ payout.day }}</span>
          <span class="min-w-0 flex-1 truncate">№ {{ payout.order }}</span>
          <Badge v-if="payout.mismatch" variant="warn">не сходится с журналом</Badge>
          <span class="whitespace-nowrap tabular-nums">{{ payout.amount }}</span>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
