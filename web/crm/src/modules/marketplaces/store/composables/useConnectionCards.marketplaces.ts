import type {
  ConnectionCard,
  ConnectionCheck,
  OzonCredentialsInput,
  TokenReplaced,
} from '../../marketplaces.domain';
import type { MarketplaceKey } from '@/navigation';

import { ref } from 'vue';

import { marketplacesApi } from '../../api/marketplacesApi.marketplaces';

import { useBaseState } from '@/shared/composables';

/**
 * Карточки «Подключений» (TASK-161). В отличие от списка площадок в сайдбаре,
 * грузятся при каждом открытии экрана: здесь продавец решает, менять ли ключ,
 * и устаревшая дата проверки ввела бы в заблуждение.
 *
 * Замена ключа и проверка меняют и статус площадки в сайдбаре — `onChanged`
 * перечитывает тот список.
 *
 * Замена ключа отвечает своей формой (у ЯМ — список магазинов, у Ozon — вид
 * площадки), а карточке нужны ещё маска и дата — поэтому после замены
 * карточки перечитываются целиком, а не собираются из ответа.
 */
export function useConnectionCards(options: { onChanged: () => Promise<void> }) {
  const [cards, setCards, isLoading, resetCards, hasCards] = useBaseState<ConnectionCard[]>([]);
  const error = ref<string | null>(null);
  /** Площадка, чья связь сейчас проверяется, — кнопка показывает «Проверяю…». */
  const checking = ref<MarketplaceKey | null>(null);

  async function load(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      setCards(await marketplacesApi.cards());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить подключения';
    } finally {
      isLoading.value = false;
    }
  }

  function replaceCard(card: ConnectionCard): void {
    setCards(cards.value.map((c) => (c.key === card.key ? card : c)));
  }

  /** Ошибки сети пробрасываются — тост ставит экран; итог проверки (и отказ) — ответ 200. */
  async function check(key: MarketplaceKey): Promise<ConnectionCheck> {
    checking.value = key;
    try {
      const result = await marketplacesApi.check(key);
      if (result.connection !== null) replaceCard(result.connection);
      await options.onChanged();
      return result.check;
    } finally {
      checking.value = null;
    }
  }

  /** Ошибки пробрасываются: под поле их ставит форма (по `code`). */
  async function replaceYmToken(token: string): Promise<TokenReplaced> {
    const result = await marketplacesApi.replaceYmToken(token);
    await Promise.all([load(), options.onChanged()]);
    return result;
  }

  async function connectOzon(input: OzonCredentialsInput): Promise<void> {
    await marketplacesApi.connectOzon(input);
    await Promise.all([load(), options.onChanged()]);
  }

  async function connectWb(token: string): Promise<void> {
    await marketplacesApi.connectWb(token);
    await Promise.all([load(), options.onChanged()]);
  }

  function reset(): void {
    resetCards();
    error.value = null;
    checking.value = null;
  }

  return {
    cards,
    isLoading,
    hasCards,
    error,
    checking,
    load,
    check,
    replaceYmToken,
    connectOzon,
    connectWb,
    reset,
  };
}
