<script setup lang="ts">
/**
 * Заливка — полупрозрачный foreground, а не `bg-muted`: в тёмной теме `--muted`
 * совпадает с `--card`, и скелетон на карточке был невидим — плитка
 * загружалась, а выглядела пустой.
 */
import type { HTMLAttributes } from 'vue';

import { cn } from '@/lib/utils';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <div :class="cn('animate-pulse rounded-md bg-foreground/10', props.class)">
    <slot />
  </div>
</template>
