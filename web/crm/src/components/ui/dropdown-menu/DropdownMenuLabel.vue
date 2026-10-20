<script setup lang="ts">
import type { DropdownMenuLabelProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';

import { reactiveOmit } from '@vueuse/core';
import { DropdownMenuLabel } from 'reka-ui';

import { cn } from '@/lib/utils';

const props = defineProps<DropdownMenuLabelProps & { class?: HTMLAttributes['class'] }>();
const delegated = reactiveOmit(props, 'class');
</script>

<template>
  <DropdownMenuLabel
    v-bind="delegated"
    :class="cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', props.class)"
  >
    <slot />
  </DropdownMenuLabel>
</template>
