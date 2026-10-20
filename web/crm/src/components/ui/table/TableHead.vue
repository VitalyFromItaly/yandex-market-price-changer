<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

import { cn } from '@/lib/utils';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <th
    :class="
      cn(
        'h-9 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold text-muted-foreground',
        props.class,
      )
    "
  >
    <slot />
  </th>
</template>
