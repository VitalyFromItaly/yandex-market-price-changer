<script setup lang="ts">
/**
 * Рентабельность по чистой по месяцам — один ряд, полоса на месяц. Последняя
 * полоса — прогноз текущего месяца, штрихованная и с меткой: факт и оценку
 * нельзя читать одинаково.
 */
import type { MarginBar, Tone } from '../forecast.domain';

import { Badge } from '@/components/ui/badge';

defineProps<{ bars: MarginBar[] }>();

const BAR_CLASS: Record<Tone, string> = {
  ok: 'bg-ok',
  danger: 'bg-danger',
  muted: 'bg-muted',
};
</script>

<template>
  <ul class="flex flex-col gap-2 text-sm">
    <li
      v-for="bar in bars"
      :key="bar.month"
      class="grid grid-cols-[4.5rem_1fr_6rem] items-center gap-3"
    >
      <span class="tnum text-muted-foreground">{{ bar.label }}</span>
      <span class="h-2.5 rounded-full bg-muted/40">
        <span
          class="block h-full rounded-full"
          :class="[BAR_CLASS[bar.tone], bar.forecast ? 'opacity-60' : '']"
          :style="{ width: `${Math.max(bar.width * 100, bar.width ? 2 : 0)}%` }"
        />
      </span>
      <span class="tnum flex items-center justify-end gap-1.5 text-right">
        <Badge v-if="bar.forecast" variant="outline">прогноз</Badge>
        {{ bar.value }}
      </span>
    </li>
  </ul>
</template>
