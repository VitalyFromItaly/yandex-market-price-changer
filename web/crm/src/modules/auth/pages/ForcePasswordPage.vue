<script setup lang="ts">
import { useRouter } from 'vue-router';

import PasswordChangeForm from '../components/PasswordChangeForm.vue';
import { useLogout } from '../composables/useLogout.auth';
import { HOME_PATH } from '../constants/routeNames.auth';

import AuthLayout from '@/components/layout/AuthLayout.vue';
import { Button } from '@/components/ui/button';

const router = useRouter();
const { logout } = useLogout();

async function goHome(): Promise<void> {
  await router.replace(HOME_PATH);
}
</script>

<template>
  <AuthLayout
    title="Придумайте свой пароль"
    description="Стартовый пароль общий для всех — пока он не сменён, CRM закрыта"
  >
    <PasswordChangeForm @done="goHome" />
    <template #footer>
      <Button variant="ghost" size="sm" class="self-center" @click="logout">Выйти</Button>
    </template>
  </AuthLayout>
</template>
