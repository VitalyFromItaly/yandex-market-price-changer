<script setup lang="ts">
/**
 * Меню действий (`⋯` в шапке, переключатель маркетплейса).
 * Tooltip на его триггер НЕ вешается: в reka-ui оба биндят элемент через
 * as-child и вместе ломаются (см. frontend-design) — хватает aria-label.
 */
import type { DropdownMenuRootEmits, DropdownMenuRootProps } from 'reka-ui';

import { DropdownMenuRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<DropdownMenuRootProps>();
const emits = defineEmits<DropdownMenuRootEmits>();
const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <DropdownMenuRoot v-bind="forwarded">
    <slot />
  </DropdownMenuRoot>
</template>
