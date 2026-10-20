<script setup lang="ts">
/** Активная вкладка живёт в URL (правило frontend-module): модель — writable computed на роутере. */
import type { TabsRootEmits, TabsRootProps } from 'reka-ui';

import { TabsRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<TabsRootProps>();
const emits = defineEmits<TabsRootEmits>();
const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <TabsRoot v-bind="forwarded">
    <slot />
  </TabsRoot>
</template>
