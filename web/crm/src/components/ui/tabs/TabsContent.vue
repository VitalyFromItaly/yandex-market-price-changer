<script setup lang="ts">
import type { TabsContentProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';

import { reactiveOmit } from '@vueuse/core';
import { TabsContent } from 'reka-ui';

import { cn } from '@/lib/utils';

const props = defineProps<TabsContentProps & { class?: HTMLAttributes['class'] }>();
const delegated = reactiveOmit(props, 'class');
</script>

<template>
  <TabsContent v-bind="delegated" :class="cn('mt-4 focus-visible:outline-none', props.class)">
    <slot />
  </TabsContent>
</template>
