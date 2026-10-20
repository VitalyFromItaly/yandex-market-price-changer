<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

import { computed } from 'vue';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Поле формы: подпись, контрол и ошибка ПОД ним. Слот получает атрибуты,
 * которые надо навесить на контрол, — связь подписи и ошибки с полем держится
 * здесь, а не вспоминается в каждой форме.
 */
const props = defineProps<{
  id: string;
  label: string;
  error?: string | null;
  class?: HTMLAttributes['class'];
}>();

const errorId = computed(() => `${props.id}-error`);
const invalid = computed(() => typeof props.error === 'string' && props.error.length > 0);
const controlAttrs = computed(() => ({
  id: props.id,
  'aria-invalid': invalid.value ? 'true' : undefined,
  'aria-describedby': invalid.value ? errorId.value : undefined,
}));
</script>

<template>
  <div :class="cn('flex flex-col gap-1.5', props.class)">
    <Label :for="id">{{ label }}</Label>
    <slot :attrs="controlAttrs" />
    <p v-if="invalid" :id="errorId" class="text-sm text-danger" role="alert">{{ error }}</p>
  </div>
</template>
