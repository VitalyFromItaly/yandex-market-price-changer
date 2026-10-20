import type { PiniaPluginContext } from 'pinia';

interface Resettable {
  $id: string;
  reset: () => void;
}

/*
 * Реестр — по $id, а не Set экземпляров: после выхода pinia может пересоздать
 * стор, и в Set остался бы мёртвый экземпляр рядом с живым.
 */
const registry = new Map<string, Resettable>();

function isResettable(store: unknown): store is Resettable {
  return typeof (store as { reset?: unknown }).reset === 'function';
}

/**
 * Плагин Pinia: сам регистрирует каждый стор, у которого есть `reset()`.
 * Сторы без reset (auth с его clear()) сюда не попадают — намеренно.
 */
export function resettableStoresPlugin({ store }: PiniaPluginContext): void {
  if (isResettable(store)) registry.set(store.$id, store);
}

/** Чистит все сторы с состоянием: выход, 401 с любого запроса, смена магазина. */
export function resetAllStores(): void {
  for (const store of registry.values()) store.reset();
}
