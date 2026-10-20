<script setup lang="ts">
/**
 * Пустое состояние объясняет, почему пусто, и зовёт к следующему шагу.
 * Основную кнопку страницы сюда не дублировать — она в PageHeader #actions.
 */
import type { Component } from 'vue';

defineProps<{ title: string; description?: string; icon?: Component }>();
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center"
  >
    <component
      :is="icon"
      v-if="icon"
      class="mb-1 size-8 text-muted-foreground"
      aria-hidden="true"
    />
    <p class="text-sm font-medium">{{ title }}</p>
    <p v-if="description" class="max-w-md text-sm text-muted-foreground">{{ description }}</p>
    <slot />
  </div>
</template>
