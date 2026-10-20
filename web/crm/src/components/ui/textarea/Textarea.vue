<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

import { cn } from '@/lib/utils';

/** Многострочное поле — пара к `Input`: те же рамка, фокус и `aria-invalid`. */
const props = defineProps<{ class?: HTMLAttributes['class'] }>();
const model = defineModel<string>();
</script>

<template>
  <textarea
    v-model="model"
    :class="
      cn(
        'flex min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
          'shadow-sm placeholder:text-muted-foreground focus-visible:outline-none ' +
          'focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed ' +
          'disabled:opacity-50 aria-[invalid=true]:border-danger',
        props.class,
      )
    "
  />
</template>
