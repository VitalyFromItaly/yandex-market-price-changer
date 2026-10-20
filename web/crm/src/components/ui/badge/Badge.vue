<script setup lang="ts">
import type { BadgeVariants } from '.';
import type { HTMLAttributes } from 'vue';

import { badgeVariants } from '.';

import { cn } from '@/lib/utils';

const props = defineProps<{
  variant?: BadgeVariants['variant'];
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <span :class="cn(badgeVariants({ variant: props.variant }), props.class)">
    <slot />
  </span>
</template>
