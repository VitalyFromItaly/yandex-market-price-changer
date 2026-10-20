<script setup lang="ts">
/**
 * Заголовок сортируемой колонки: кнопка внутри <th> с `aria-sort`, чтобы
 * сортировка работала с клавиатуры и читалась скринридером. Состояние
 * сортировки держит вызывающий — примитив только показывает и сообщает клик.
 */
import type { HTMLAttributes } from 'vue';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-vue-next';
import { computed } from 'vue';

import { cn } from '@/lib/utils';

const props = defineProps<{
  label: string;
  active: boolean;
  direction: 'asc' | 'desc';
  align?: 'left' | 'right';
  class?: HTMLAttributes['class'];
}>();
const emit = defineEmits<{ sort: [] }>();

const ariaSort = computed(() => {
  if (!props.active) return 'none';
  return props.direction === 'asc' ? 'ascending' : 'descending';
});
const icon = computed(() => {
  if (!props.active) return ArrowUpDown;
  return props.direction === 'asc' ? ArrowUp : ArrowDown;
});
</script>

<template>
  <th
    :aria-sort="ariaSort"
    :class="
      cn(
        'h-10 px-3 align-middle text-xs font-medium text-muted-foreground',
        align === 'right' ? 'text-right' : 'text-left',
        props.class,
      )
    "
  >
    <button
      type="button"
      :class="
        cn(
          'inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none ' +
            'focus-visible:ring-2 focus-visible:ring-ring',
          active && 'text-foreground',
          align === 'right' && 'flex-row-reverse',
        )
      "
      @click="emit('sort')"
    >
      {{ label }}
      <component :is="icon" class="size-3.5 shrink-0" aria-hidden="true" />
    </button>
  </th>
</template>
