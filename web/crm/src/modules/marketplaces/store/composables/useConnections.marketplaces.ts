import type { MarketplaceConnection } from '../../marketplaces.domain';
import type { MarketplaceKey } from '@/navigation';

import { ref } from 'vue';

import { marketplacesApi } from '../../api/marketplacesApi.marketplaces';

import { useBaseState } from '@/shared/composables';

/**
 * Подключения площадок продавца. Грузятся один раз за сессию стора (после
 * выхода или смены магазина — заново): статус меняется только на
 * «Подключениях», и они зовут `refresh`, а запрос — два чтения Mongo на
 * каждый переход.
 */
export function useConnections() {
  const [connections, setConnections, isLoading, resetConnections, hasConnections] = useBaseState<
    MarketplaceConnection[]
  >([]);
  const error = ref<string | null>(null);

  async function ensure(): Promise<void> {
    if (hasConnections.value || isLoading.value) return;
    isLoading.value = true;
    error.value = null;
    try {
      setConnections(await marketplacesApi.list());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить площадки';
    } finally {
      isLoading.value = false;
    }
  }

  /** null — сервер ещё не ответил: «неизвестно», а не «не подключена». */
  function connectionOf(key: MarketplaceKey): MarketplaceConnection | null {
    return connections.value.find((c) => c.key === key) ?? null;
  }

  /** Ключ площадки сменили или перепроверили — статус в сайдбаре должен догнать. */
  async function refresh(): Promise<void> {
    resetConnections();
    error.value = null;
    await ensure();
  }

  function reset(): void {
    resetConnections();
    error.value = null;
  }

  return {
    connections,
    isLoading,
    hasConnections,
    error,
    ensure,
    connectionOf,
    refresh,
    reset,
  };
}
