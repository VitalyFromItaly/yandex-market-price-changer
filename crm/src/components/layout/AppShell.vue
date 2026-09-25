<script setup lang="ts">
import { Menu } from 'lucide-vue-next';
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import AppSidebar from './AppSidebar.vue';

import { Button } from '@/components/ui/button';
import { useSessionRefresh } from '@/modules/auth/composables/useSessionRefresh.auth';

/*
 * Один сайдбар на все ширины: на телефоне он выезжает поверх контента по
 * кнопке, на десктопе стоит слева. Две ветки разметки (useMediaQuery) — два
 * места, где забыть поправить.
 */
const menuOpen = ref(false);
// Пароль сменили в другой вкладке или доступ отозвали — узнаём при возврате сюда.
useSessionRefresh();
const route = useRoute();
watch(
  () => route.fullPath,
  () => (menuOpen.value = false),
);
</script>

<template>
  <div class="min-h-screen md:flex">
    <div class="flex h-14 items-center gap-2 border-b px-4 md:hidden">
      <Button variant="ghost" size="icon" aria-label="Открыть меню" @click="menuOpen = true">
        <Menu />
      </Button>
      <span class="text-sm font-semibold">CRM продавца</span>
    </div>

    <div
      v-if="menuOpen"
      class="fixed inset-0 z-40 bg-black/40 md:hidden"
      aria-hidden="true"
      @click="menuOpen = false"
    />
    <AppSidebar
      :class="[
        'fixed inset-y-0 left-0 z-50 w-64 -translate-x-full transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0',
        menuOpen && 'translate-x-0',
      ]"
      @close="menuOpen = false"
    />

    <main class="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
      <div class="mx-auto max-w-6xl">
        <RouterView />
      </div>
    </main>
  </div>
</template>
