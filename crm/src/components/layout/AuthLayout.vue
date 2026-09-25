<script setup lang="ts">
import BrandMark from './BrandMark.vue';
import ThemeToggle from './ThemeToggle.vue';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Экраны без сайдбара: вход и принудительная смена пароля. Пока пароль не
 * сменён, в CRM нечего показывать — и меню разделов было бы обещанием, которое
 * гвард тут же не выполнит.
 */
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background px-4 py-10">
    <div class="flex w-full max-w-sm flex-col gap-4">
      <div class="flex items-center justify-between gap-2">
        <p class="flex items-center gap-2 text-sm font-semibold">
          <BrandMark />
          CRM продавца
        </p>
        <ThemeToggle />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{{ title }}</CardTitle>
          <CardDescription v-if="description">{{ description }}</CardDescription>
        </CardHeader>
        <CardContent>
          <slot />
        </CardContent>
      </Card>
      <slot name="footer" />
    </div>
  </div>
</template>
