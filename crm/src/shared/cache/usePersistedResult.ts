import type { CacheEntry } from './reportCache';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';

import { StorageSerializers, useStorage } from '@vueuse/core';
import { computed, shallowReactive, toValue } from 'vue';

import { CACHE_PREFIX, clearStoredCache, isFresh, persistEntry, safeStorage } from './reportCache';

/*
 * Память вкладки поверх localStorage: запись, которая в хранилище не влезла
 * (больше лимита, квота, приватный режим), живёт здесь до перезагрузки. Одна на
 * приложение — вернулись на экран, данные уже есть. shallowReactive: данные
 * отчёта (тысячи строк) глубокая реактивность только замедлила бы.
 */
const memory = shallowReactive(new Map<string, CacheEntry<unknown>>());

/** Ключ-пустышка, пока владельца нет: useStorage нужен ключ, писать в него не будем. */
const NO_KEY = `${CACHE_PREFIX}none`;

export interface PersistedResult<T> {
  /** Сохранённое для текущего ключа, если свежее недели; иначе `null`. */
  entry: ComputedRef<CacheEntry<T> | null>;
  save(data: T): void;
}

/**
 * Последние данные экрана по реактивному ключу. Чтение — vueuse `useStorage`:
 * ключ сменился (период, магазин) — запись перечитывается сама, а запись из
 * соседней вкладки приходит событием `storage`. Запись — через persistEntry:
 * там лимит размера, вытеснение и квота, которых у useStorage нет.
 */
export function usePersistedResult<T>(key: MaybeRefOrGetter<string | null>): PersistedResult<T> {
  const current = computed(() => toValue(key));
  const storage = safeStorage();

  const stored = useStorage<CacheEntry<T> | null>(
    () => current.value ?? NO_KEY,
    null,
    storage ?? undefined,
    {
      serializer: StorageSerializers.object,
      writeDefaults: false,
      shallow: true,
      // Битая запись или запрещённое хранилище — просто нет кэша.
      onError: () => undefined,
    },
  );

  const entry = computed<CacheEntry<T> | null>(() => {
    const k = current.value;
    if (k === null) return null;
    const inMemory = memory.get(k) as CacheEntry<T> | undefined;
    const fromStorage = stored.value;
    const newest =
      inMemory !== undefined &&
      (fromStorage === null || Date.parse(inMemory.savedAt) >= Date.parse(fromStorage.savedAt))
        ? inMemory
        : fromStorage;
    return isFresh(newest, Date.now()) ? newest : null;
  });

  function save(data: T): void {
    const k = current.value;
    if (k === null) return;
    const next: CacheEntry<T> = { savedAt: new Date().toISOString(), data };
    memory.set(k, next);
    if (storage === null) return;
    try {
      persistEntry(storage, k, JSON.stringify(next), Date.now());
    } catch {
      // Не сериализовалось — остаётся в памяти вкладки.
    }
  }

  return { entry, save };
}

/** Выход и 401: стереть кэш аккаунта в памяти и в хранилище. */
export function clearReportCache(): void {
  memory.clear();
  clearStoredCache(safeStorage());
}
