<script setup lang="ts">
import type { AlertVariants } from '.';
import type { HTMLAttributes } from 'vue';

import { CircleAlert, Info } from 'lucide-vue-next';

import { alertVariants } from '.';

import { cn } from '@/lib/utils';

const props = defineProps<{
  variant?: AlertVariants['variant'];
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <div role="alert" :class="cn(alertVariants({ variant: props.variant }), props.class)">
    <Info v-if="props.variant === 'warn'" aria-hidden="true" />
    <CircleAlert v-else aria-hidden="true" />
    <div class="min-w-0"><slot /></div>
  </div>
</template>
