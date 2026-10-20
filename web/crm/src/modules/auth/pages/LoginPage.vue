<script setup lang="ts">
import LoginForm from '../components/LoginForm.vue';
import { useAuthStore } from '../store/store.auth';

import AuthLayout from '@/components/layout/AuthLayout.vue';
import { Alert } from '@/components/ui/alert';

const auth = useAuthStore();
</script>

<template>
  <AuthLayout title="Вход" description="Тем же ником или Telegram id, что и в боте">
    <Alert v-if="auth.notice" variant="warn" class="mb-4">{{ auth.notice }}</Alert>
    <LoginForm />
  </AuthLayout>
</template>
