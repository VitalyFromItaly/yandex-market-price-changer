<script setup lang="ts" generic="T extends string">
/**
 * Выпадающий список одного значения — нативный `<select>` в стиле Input: длинные
 * списки (статусы, магазины), где кнопки OptionGroup не помещаются. Нативный — ради
 * доступности и мобильного выбора из коробки. `null` — пункт «все» (`placeholder`).
 */
import type { HTMLAttributes } from 'vue';

import { ChevronDown } from 'lucide-vue-next';

import { cn } from '@/lib/utils';

const props = defineProps<{
  modelValue: T | null;
  options: readonly { value: T; label: string }[];
  /** Доступное имя — подпись того, что выбирается. */
  label: string;
  /** Подпись пункта «без выбора»; не задана — пункта нет. */
  placeholder?: string;
  disabled?: boolean;
  class?: HTMLAttributes['class'];
}>();
const emit = defineEmits<{ 'update:modelValue': [T | null] }>();

function onChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  emit('update:modelValue', value === '' ? null : (value as T));
}
</script>

<template>
  <div :class="cn('relative', props.class)">
    <select
      :value="modelValue ?? ''"
      :aria-label="label"
      :disabled="disabled"
      class="flex h-9 w-full appearance-none rounded-md border border-input bg-background py-1 pl-3 pr-8 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      @change="onChange"
    >
      <option v-if="placeholder !== undefined" value="">{{ placeholder }}</option>
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <ChevronDown
      class="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
  </div>
</template>
