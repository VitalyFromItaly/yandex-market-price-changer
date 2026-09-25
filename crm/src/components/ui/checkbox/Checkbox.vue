<script setup lang="ts">
/**
 * Флажок с подписью. Настоящий `<input type="checkbox">`: фокус, пробел и
 * `:disabled` работают без кода (довод ToggleSwitch админки).
 */
import type { HTMLAttributes } from 'vue';

import { cn } from '@/lib/utils';

// Атрибуты поля (id, aria-*) — на сам <input>, а не на обёртку-label.
defineOptions({ inheritAttrs: false });

const props = defineProps<{ label: string; disabled?: boolean; class?: HTMLAttributes['class'] }>();
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <label
    :class="
      cn(
        'inline-flex cursor-pointer items-center gap-2 text-sm',
        disabled && 'cursor-not-allowed opacity-50',
        props.class,
      )
    "
  >
    <input
      v-model="model"
      v-bind="$attrs"
      type="checkbox"
      :disabled="disabled"
      class="size-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
    <span>{{ label }}</span>
    <slot />
  </label>
</template>
