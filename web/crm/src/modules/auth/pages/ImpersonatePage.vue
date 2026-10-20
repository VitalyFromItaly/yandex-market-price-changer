<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { HOME_PATH } from '../constants/routeNames.auth';
import { useAuthStore } from '../store/store.auth';

import AuthLayout from '@/components/layout/AuthLayout.vue';
import { Alert } from '@/components/ui/alert';
import { clearReportCache } from '@/shared/cache';
import { resetAllStores } from '@/shared/store';

/*
 * Вход админа «за продавца»: админ-панель открывает эту страницу в новой вкладке
 * с токеном в ?token= (внутри #-адреса — на сервер и в журнал он не уходит).
 * Токен кладём в сессию вкладки и сразу убираем из адреса replace-ом, чтобы он
 * не остался в истории и не уехал со скопированной ссылкой.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const error = ref<string | null>(null);

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : '';
  if (token.length === 0) {
    error.value = 'В ссылке нет токена — откройте режим заново из карточки продавца в админ-панели';
    return;
  }
  resetAllStores();
  clearReportCache();
  try {
    await auth.impersonate(token);
    await router.replace(HOME_PATH);
  } catch {
    // 401 уже увёл на вход с причиной (installAuth); сюда попадает сбой сети.
    if (auth.isAuthenticated) error.value = 'Не удалось открыть CRM продавца — попробуйте ещё раз';
  }
});
</script>

<template>
  <AuthLayout title="Вход за продавца" description="Режим администратора">
    <Alert v-if="error" variant="danger">{{ error }}</Alert>
    <p v-else class="text-sm text-muted-foreground">Открываю CRM продавца…</p>
  </AuthLayout>
</template>
