<script setup lang="ts">
import { Menu } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import AppSidebar from './AppSidebar.vue';
import ImpersonationBanner from './ImpersonationBanner.vue';

import { Button } from '@/components/ui/button';
import { useSessionRefresh } from '@/modules/auth/composables/useSessionRefresh.auth';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useSidebarCollapsed } from '@/shared/composables';

/*
 * Один сайдбар на все ширины: на телефоне он выезжает поверх контента по
 * кнопке, на десктопе стоит слева. Две ветки разметки (useMediaQuery) — два
 * места, где забыть поправить.
 */
const menuOpen = ref(false);
// Свёрнут только на десктопе: на телефоне меню выезжает целиком, как было.
const { collapsed, toggle } = useSidebarCollapsed();
// Пароль сменили в другой вкладке или доступ отозвали — узнаём при возврате сюда.
useSessionRefresh();
const route = useRoute();
// Режим «за продавца»: плашка сверху, сайдбар начинается под ней.
const auth = useAuthStore();
const impersonating = computed(() => (auth.me?.impersonation ?? null) !== null);
watch(
  () => route.fullPath,
  () => (menuOpen.value = false),
);
</script>

<template>
  <!-- Канва — с мягким свечением акцента сверху, как в макете; на токене, без литерала. -->
  <ImpersonationBanner v-if="impersonating" />
  <div
    class="min-h-screen bg-[radial-gradient(1000px_450px_at_70%_-150px,hsl(var(--primary)/0.12),transparent)] md:flex"
  >
    <div class="flex h-14 items-center gap-2 border-b px-4 md:hidden">
      <Button variant="ghost" size="icon" aria-label="Открыть меню" @click="menuOpen = true">
        <Menu />
      </Button>
      <span class="text-sm font-extrabold tracking-tight">MarketHub</span>
    </div>

    <div
      v-if="menuOpen"
      class="fixed inset-0 z-40 bg-black/40 md:hidden"
      aria-hidden="true"
      @click="menuOpen = false"
    />
    <AppSidebar
      :class="[
        'fixed bottom-0 left-0 z-50 w-64 shrink-0 -translate-x-full transition-[transform,width] md:sticky md:translate-x-0',
        impersonating ? 'top-10 md:top-10 md:h-[calc(100vh-2.5rem)]' : 'top-0 md:top-0 md:h-screen',
        collapsed ? 'md:w-16' : 'md:w-64',
        menuOpen && 'translate-x-0',
      ]"
      :collapsed="collapsed"
      @close="menuOpen = false"
      @toggle="toggle"
    />

    <main class="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">
      <div class="mx-auto max-w-screen-2xl">
        <RouterView />
      </div>
    </main>
  </div>
</template>
