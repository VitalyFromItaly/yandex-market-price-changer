<script setup lang="ts" generic="T extends string | number">
/**
 * Выбор одного из нескольких вариантов кнопками — как пресеты периода в
 * PeriodPicker и кнопки бота. Для коротких списков (2–8 вариантов), где
 * выпадающий список прятал бы то, что и так помещается.
 */
import { Button } from '@/components/ui/button';

defineProps<{
  modelValue: T | null;
  options: readonly { value: T; label: string }[];
  /** Доступное имя группы — подпись того, что выбирается. */
  label: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [T] }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="label">
    <Button
      v-for="option in options"
      :key="option.value"
      size="sm"
      :variant="option.value === modelValue ? 'soft' : 'ghost'"
      :aria-pressed="option.value === modelValue"
      :disabled="disabled"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </Button>
  </div>
</template>
