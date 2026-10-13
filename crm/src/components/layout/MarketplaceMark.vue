<script setup lang="ts">
/**
 * Знак площадки — оригинальные иконки Яндекс Маркета, Ozon и Wildberries
 * (фавиконы сайтов, 128px), лежат в бандле: прод в РФ, внешние домены и CDN
 * оттуда недоступны. Неизвестная площадка — первая буква на приглушённой плашке.
 */
import { computed } from 'vue';

import ozon from '@/assets/marketplaces/ozon.png';
import wb from '@/assets/marketplaces/wb.png';
import ym from '@/assets/marketplaces/ym.png';
import { cn } from '@/lib/utils';

const props = defineProps<{
  marketplace: string;
  size?: 'sm' | 'md';
  /** Площадка ещё не подключена — знак приглушён. */
  muted?: boolean;
  class?: string;
}>();

const LOGOS: Record<string, string> = { ym, ozon, wb };

const src = computed(() => LOGOS[props.marketplace] ?? null);
const box = computed(() => (props.size === 'md' ? 'size-8 rounded-lg' : 'size-7 rounded-md'));
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden',
        box,
        muted && 'opacity-50 grayscale-[40%]',
        props.class,
      )
    "
    aria-hidden="true"
  >
    <img v-if="src" :src="src" alt="" class="size-full object-cover" draggable="false" />
    <span v-else class="flex size-full items-center justify-center bg-muted text-xs font-semibold">
      {{ marketplace.slice(0, 1).toUpperCase() }}
    </span>
  </span>
</template>
