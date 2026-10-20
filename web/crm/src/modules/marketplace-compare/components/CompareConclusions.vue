<script setup lang="ts">
/**
 * Выводы — сравнения чисел, посчитанные сервером (не ИИ). Победитель — бейджем,
 * «сравнить не с чем» или «поровну» — причиной вместо победителя.
 */
import type { CompareConclusion, MarketplaceCompareResponse } from '../marketplace-compare.domain';

import { marketplaceLabel } from '../mappers/mapCompare.marketplace-compare';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatKopecks } from '@/shared/utils';

defineProps<{ data: MarketplaceCompareResponse; conclusions: readonly CompareConclusion[] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Выводы</CardTitle>
    </CardHeader>
    <CardContent>
      <ul class="flex flex-col divide-y">
        <li
          v-for="item in conclusions"
          :key="item.kind"
          class="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{{ item.title }}</span>
            <Badge v-if="item.winner" variant="brand">
              {{ marketplaceLabel(data, item.winner)
              }}<template v-if="item.scheme"> · {{ item.scheme }}</template>
            </Badge>
          </div>
          <p class="text-sm" :class="item.text ? '' : 'text-muted-foreground'">
            {{ item.text ?? item.reason }}
          </p>
          <ul v-if="item.products?.length" class="text-xs text-muted-foreground">
            <li v-for="product in item.products" :key="product.sku" class="tnum">
              {{ product.sku }}: {{ marketplaceLabel(data, product.winner) }}
              {{ formatKopecks(product.winnerPerUnitKopecks) }}/шт. против
              {{ formatKopecks(product.runnerUpPerUnitKopecks) }} на
              {{ marketplaceLabel(data, product.runnerUp) }}
            </li>
          </ul>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
