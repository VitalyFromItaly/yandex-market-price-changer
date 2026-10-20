<script setup lang="ts">
import type { DropdownMenuItemProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';

import { reactiveOmit } from '@vueuse/core';
import { DropdownMenuItem } from 'reka-ui';

import { cn } from '@/lib/utils';

const props = defineProps<DropdownMenuItemProps & { class?: HTMLAttributes['class'] }>();
const delegated = reactiveOmit(props, 'class');
</script>

<template>
  <DropdownMenuItem
    v-bind="delegated"
    :class="
      cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4',
        props.class,
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
