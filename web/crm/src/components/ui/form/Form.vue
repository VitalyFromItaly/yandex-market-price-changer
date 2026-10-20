<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

import { cn } from '@/lib/utils';

/**
 * Форма со стандартным ритмом полей. Отправка — событием `submit` без
 * перезагрузки; браузерная валидация выключена: ошибки показываются у поля
 * нашими словами, а не всплывашкой браузера.
 */
const props = defineProps<{ class?: HTMLAttributes['class'] }>();
const emit = defineEmits<{ submit: [] }>();
</script>

<template>
  <form novalidate :class="cn('flex flex-col gap-4', props.class)" @submit.prevent="emit('submit')">
    <slot />
  </form>
</template>
