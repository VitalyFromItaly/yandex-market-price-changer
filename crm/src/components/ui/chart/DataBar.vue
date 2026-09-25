<script setup lang="ts">
/**
 * Полоса внутри строки или ячейки таблицы — величина рядом с числом, а не
 * вместо него. Число печатает сама таблица: полоса только подсказывает
 * масштаб, поэтому aria-hidden. Три режима:
 * - `value/max` — доля от максимума колонки;
 * - `step` — готовый отрезок (ступень водопада, расходящаяся полоса);
 * - `marker` — метка на шкале (эталон категории, плоская комиссия).
 */
import type { ChartTone, WaterfallStep } from './chart.domain';

import { computed } from 'vue';

import { TONE_BG, ratio } from './chart.domain';

import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    value?: number;
    max?: number;
    step?: WaterfallStep | null;
    /** Метка на шкале, 0…1. */
    marker?: number | null;
    /** Центральная линия нуля — для расходящихся полос. */
    center?: boolean;
    tone?: ChartTone;
    class?: string;
  }>(),
  { value: 0, max: 0, step: null, marker: null, center: false, tone: 'series', class: '' },
);

const span = computed<WaterfallStep>(
  () => props.step ?? { left: 0, width: ratio(props.value, props.max) },
);
const pct = (share: number): string => `${(share * 100).toFixed(2)}%`;
</script>

<template>
  <div :class="cn('relative h-1.5 w-full rounded-full bg-muted', props.class)" aria-hidden="true">
    <div
      class="absolute inset-y-0 rounded-full transition-[left,width] duration-300"
      :class="TONE_BG[tone]"
      :style="{ left: pct(span.left), width: pct(span.width) }"
    />
    <div v-if="center" class="absolute -inset-y-0.5 left-1/2 w-px bg-foreground/30" />
    <div
      v-if="marker !== null"
      class="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
      :style="{ left: pct(marker) }"
    />
  </div>
</template>
