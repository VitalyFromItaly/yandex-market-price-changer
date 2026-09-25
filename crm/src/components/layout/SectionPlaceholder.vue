<script setup lang="ts">
import { Construction } from 'lucide-vue-next';
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

/** Заглушка раздела, пока его модуль не написан. Маршруты модулей заменяют её по одному. */
const route = useRoute();
const title = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : 'Раздел'));
const description = computed(() =>
  typeof route.meta.description === 'string' ? route.meta.description : undefined,
);
</script>

<template>
  <PageHeader :title="title" :description="description" />
  <EmptyState
    :icon="Construction"
    title="Раздел скоро появится"
    description="Пока этим можно пользоваться в Telegram-боте — там всё работает как прежде."
  />
</template>
