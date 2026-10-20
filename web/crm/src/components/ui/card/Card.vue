<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

import { cn } from '@/lib/utils';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <div
    :class="
      cn(
        'relative rounded-xl border bg-gradient-to-br from-card to-card-2 text-card-foreground shadow-panel',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
