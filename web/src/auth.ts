import { ref } from 'vue';

import { ApiError, clearToken, loadToken, login as requestLogin, saveToken } from './api';

/**
 * Состояние входа — одно на всю панель.
 *
 * Модульные `ref` вместо Pinia: состояния три поля, и тащить хранилище ради
 * них значило бы добавить зависимость больше самого экрана. Реактивность у
 * модульного `ref` ровно та же — он и есть общий экземпляр.
 *
 * Понадобилось это, когда экранов стало три: раньше токен жил в App.vue и
 * передавался вниз пропсами, а страницы под роутером пропсов от него не
 * получают.
 */
export const token = ref<string | null>(loadToken());
export const authError = ref('');
export const busy = ref(false);

export async function signIn(loginId: string, password: string): Promise<void> {
  busy.value = true;
  authError.value = '';

  try {
    const issued = await requestLogin(loginId, password);
    saveToken(issued);
    token.value = issued;
  } catch (error) {
    authError.value = (error as ApiError).message;
  } finally {
    busy.value = false;
  }
}

export function signOut(): void {
  clearToken();
  token.value = null;
}

/**
 * Разбор ошибки запроса: возвращает текст для показа на странице или пустую
 * строку, если пользователя уже выкинуло на форму входа.
 *
 * Разница принципиальная и стоила бага: протухшая сессия требует войти заново,
 * сетевой сбой — только повторить. Пока обе ситуации выглядели одинаково,
 * панель на каждый обрыв связи выкидывала на форму входа.
 */
export function describeError(error: unknown): string {
  const apiError = error as ApiError;
  if (apiError?.isAuthError) {
    signOut();
    authError.value = apiError.message;
    return '';
  }
  return apiError?.message ?? String(error);
}
