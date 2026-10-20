import type { LoginForm } from '../auth.domain';

import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAuthStore } from '../store/store.auth';

import { safeRedirect } from './useAuthGuard.auth';

/** Форма входа: поля, ожидание ответа, ошибка сервера текстом. */
export function useLoginForm() {
  const auth = useAuthStore();
  const route = useRoute();
  const router = useRouter();

  const form = reactive<LoginForm>({ login: '', password: '' });
  const busy = ref(false);
  const error = ref<string | null>(null);

  async function submit(): Promise<void> {
    if (form.login.trim().length === 0 || form.password.length === 0) {
      error.value = 'Введите ник или Telegram id и пароль';
      return;
    }
    busy.value = true;
    error.value = null;
    try {
      await auth.login({ login: form.login.trim(), password: form.password });
      // Гвард сам уведёт на смену пароля, если она нужна.
      await router.replace(safeRedirect(route.query.redirect));
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось войти';
      form.password = '';
    } finally {
      busy.value = false;
    }
  }

  return { form, busy, error, submit };
}
