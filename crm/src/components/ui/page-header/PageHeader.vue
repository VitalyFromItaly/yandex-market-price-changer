<script setup lang="ts">
/**
 * Шапка экрана. Основное действие страницы — ТОЛЬКО в слоте #actions: одна
 * полная кнопка, вторичные — outline, больше двух — в меню `⋯`.
 * Слот #filters — выбор периода и фильтры (в бюджет действий не входят).
 */
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <header class="mb-6 flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold tracking-tight">{{ title }}</h1>
        <p v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="$slots.filters" class="flex flex-wrap items-center gap-2">
      <slot name="filters" />
    </div>
  </header>
</template>
