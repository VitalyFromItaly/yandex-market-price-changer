<script setup lang="ts">
import type { DropdownMenuSeparatorProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';

import { reactiveOmit } from '@vueuse/core';
import { DropdownMenuSeparator } from 'reka-ui';

import { cn } from '@/lib/utils';

const props = defineProps<DropdownMenuSeparatorProps & { class?: HTMLAttributes['class'] }>();
const delegated = reactiveOmit(props, 'class');
</script>

<template>
  <DropdownMenuSeparator v-bind="delegated" :class="cn('-mx-1 my-1 h-px bg-border', props.class)">
    <slot />
  </DropdownMenuSeparator>
</template>
