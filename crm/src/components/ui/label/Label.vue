<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

import { Label } from 'reka-ui';

import { cn } from '@/lib/utils';

const props = defineProps<{ for?: string; class?: HTMLAttributes['class'] }>();
</script>

<template>
  <Label
    :for="props.for"
    :class="cn('text-sm font-medium leading-none text-foreground', props.class)"
  >
    <slot />
  </Label>
</template>
