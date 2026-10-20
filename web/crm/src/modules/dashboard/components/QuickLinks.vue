<script setup lang="ts">
/** Быстрые ссылки — открытые разделы магазина, те же пункты и подписи, что в меню. */
import type { NavItem } from '@/navigation';

import { RouterLink } from 'vue-router';

defineProps<{ items: NavItem[] }>();
</script>

<template>
  <nav aria-label="Разделы" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
    <RouterLink
      v-for="item in items"
      :key="item.name"
      :to="{ name: item.name }"
      class="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <component
        :is="item.icon"
        class="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span class="min-w-0">
        <span class="block text-sm font-medium">{{ item.label }}</span>
        <span class="block text-xs text-muted-foreground">{{ item.description }}</span>
      </span>
    </RouterLink>
  </nav>
</template>
