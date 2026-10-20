import { ref } from 'vue';

import { tokenReplacedText } from '../mappers/mapMarketplaces.marketplaces';
import { TOKEN_FIELD_CODES } from '../marketplaces.domain';
import { useMarketplacesStore } from '../store/store.marketplaces';

import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { ApiError } from '@/shared/http';

/**
 * Смена API-токена ЯМ: сервер проверяет его в Маркете и при отказе оставляет
 * прежний. Отказ по самому токену встаёт под поле; недоступность Маркета —
 * тостом: поле тут ни при чём, прежний токен работает. `onDone` — форму на
 * карточке можно свернуть.
 */
export function useYmTokenForm(onDone: () => void = () => undefined) {
  const store = useMarketplacesStore();
  const token = ref('');
  const error = ref<string | null>(null);
  const busy = ref(false);

  async function submit(): Promise<void> {
    if (busy.value) return;
    error.value = null;
    busy.value = true;
    try {
      const result = await store.replaceYmToken(token.value.trim());
      token.value = '';
      toast.success('Токен сохранён', tokenReplacedText(result));
      onDone();
      // В боте сменился активный магазин — профиль показывает именно его.
      if (result.botStore !== null)
        void useAuthStore()
          .loadMe()
          .catch(() => undefined);
    } catch (e) {
      if (e instanceof ApiError && e.code !== null && TOKEN_FIELD_CODES.has(e.code)) {
        error.value = e.message;
      } else {
        toast.error('Токен не сохранён', e instanceof Error ? e.message : undefined);
      }
    } finally {
      busy.value = false;
    }
  }

  return { token, error, busy, submit };
}
