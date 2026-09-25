import type { PasswordErrors, PasswordForm } from '../auth.domain';

import { reactive, ref } from 'vue';

import { mapPasswordError, validatePasswordForm } from '../mappers/mapPasswordError.auth';
import { useAuthStore } from '../store/store.auth';

import { toast } from '@/components/ui/toast';

/**
 * Форма смены пароля — одна для принудительной смены и для «Безопасности».
 * Длину и совпадение проверяем до запроса; то, что знает только сервер
 * (неверный текущий, стартовый пароль), встаёт под своё поле по коду ответа.
 */
export function usePasswordForm(onDone?: () => void | Promise<void>) {
  const auth = useAuthStore();

  const form = reactive<PasswordForm>({ current: '', next: '', repeat: '' });
  const errors = ref<PasswordErrors>({});
  const busy = ref(false);

  function clearForm(): void {
    form.current = '';
    form.next = '';
    form.repeat = '';
  }

  async function submit(): Promise<void> {
    const problems = validatePasswordForm(form);
    errors.value = problems;
    if (Object.keys(problems).length > 0) return;

    busy.value = true;
    try {
      await auth.changePassword(form.current, form.next);
      clearForm();
      toast.success('Пароль изменён');
      await onDone?.();
    } catch (e) {
      errors.value = mapPasswordError(e);
    } finally {
      busy.value = false;
    }
  }

  return { form, errors, busy, submit };
}
