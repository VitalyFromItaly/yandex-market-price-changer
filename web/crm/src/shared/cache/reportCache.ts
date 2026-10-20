/**
 * Кэш последних данных экранов в localStorage — чистая часть: ключи, сроки,
 * вытеснение. Реактивную обёртку делает usePersistedResult (vueuse useStorage).
 *
 * Зачем: отчёты собираются фоном секунды и минуты, и без кэша каждый заход на
 * экран — скелетон. С кэшем экран сразу показывает прошлые данные, а свежие
 * догружаются поверх (запрос при открытии уходит всё равно).
 *
 * Правила, каждое против конкретной беды:
 * - ключ несёт id аккаунта — второй продавец в том же браузере не увидит
 *   чужие деньги; магазин и параметры — отчёт одного магазина или периода не
 *   покажется под другим;
 * - версия в префиксе — сменилась форма ответа, сменили версию, а не читаем
 *   старую форму как новую;
 * - запись старше недели не показывается — «данные на прошлый месяц» без
 *   предупреждения хуже скелетона;
 * - большая запись в localStorage не кладётся (у сайта ~5 МБ на всё), живёт
 *   только в памяти вкладки; число записей ограничено, старые вытесняются;
 * - при выходе и 401 кэш аккаунта стирается целиком (clearReportCache).
 */
export const CACHE_PREFIX = 'crm.cache.v1:';
export const INDEX_KEY = `${CACHE_PREFIX}index`;
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ENTRY_CHARS = 1_000_000;
export const MAX_ENTRIES = 30;

export interface CacheEntry<T> {
  /** ISO — момент, на который данные на экране. */
  savedAt: string;
  data: T;
}

export interface CacheScope {
  kind: string;
  /** Ключ магазина; пусто — данные уровня аккаунта (профиль, настройки). */
  store: string;
  params?: Record<string, unknown>;
}

/*
 * Владелец кэша — id продавца. shared/ не знает про модуль auth, поэтому
 * провайдер ставит installAuth — тот же приём, что setTokenProvider у http.
 */
let ownerProvider: () => string | null = () => null;

export function setCacheOwner(provider: () => string | null): void {
  ownerProvider = provider;
}

export function cacheOwner(): string | null {
  return ownerProvider();
}

/** JSON с отсортированными ключами: `{a,b}` и `{b,a}` — один ключ кэша. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, 'en'));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Ключ записи; `null` — владельца нет (сессия не загружена), кэша тоже. */
export function cacheKey(owner: string | null, scope: CacheScope): string | null {
  if (owner === null || owner === '') return null;
  return `${CACHE_PREFIX}${owner}:${scope.kind}:${scope.store}:${stableStringify(scope.params ?? {})}`;
}

export function isFresh(entry: CacheEntry<unknown> | null | undefined, now: number): boolean {
  if (entry === null || entry === undefined) return false;
  const saved = Date.parse(entry.savedAt);
  return Number.isFinite(saved) && now - saved <= TTL_MS;
}

/** Хранилище, если оно есть и не запрещено; иначе `null` — кэш только в памяти. */
export function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

type Index = [key: string, savedAt: number][];

function readIndex(storage: Storage): Index {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Index) : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: Storage, index: Index): void {
  try {
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Индекс не записался — вытеснение отстанет на шаг, данные это не портит.
  }
}

function drop(storage: Storage, keys: readonly string[]): void {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Не удалилось — протухнет по сроку.
    }
  }
}

/**
 * Отметить запись в индексе как свежую и вытеснить лишние (самые старые) и
 * протухшие. Отдаёт ключи, которые надо стереть.
 */
export function touchIndex(
  index: Index,
  key: string,
  now: number,
): { index: Index; evicted: string[] } {
  const rest = index.filter(([k]) => k !== key);
  const alive = rest.filter(([, at]) => now - at <= TTL_MS);
  const expired = rest.filter(([, at]) => now - at > TTL_MS).map(([k]) => k);
  const next: Index = [...alive, [key, now] as [string, number]].sort((a, b) => a[1] - b[1]);
  const overflow = Math.max(next.length - MAX_ENTRIES, 0);
  return {
    index: next.slice(overflow),
    evicted: [...expired, ...next.slice(0, overflow).map(([k]) => k)],
  };
}

const isQuota = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

/**
 * Записать готовый текст записи. Большую — не пишем (и стираем прежнюю, иначе
 * после F5 всплыла бы она). Квота кончилась — выбрасываем старшую половину
 * записей и пробуем один раз. `true` — запись в хранилище.
 */
export function persistEntry(storage: Storage, key: string, text: string, now: number): boolean {
  if (text.length > MAX_ENTRY_CHARS) {
    drop(storage, [key]);
    writeIndex(
      storage,
      readIndex(storage).filter(([k]) => k !== key),
    );
    return false;
  }
  const { index, evicted } = touchIndex(readIndex(storage), key, now);
  drop(storage, evicted);
  try {
    storage.setItem(key, text);
  } catch (error) {
    if (!isQuota(error)) return false;
    const half = index.filter(([k]) => k !== key).slice(0, Math.ceil(index.length / 2));
    drop(
      storage,
      half.map(([k]) => k),
    );
    const kept = index.filter(([k]) => !half.some(([h]) => h === k));
    try {
      storage.setItem(key, text);
    } catch {
      writeIndex(
        storage,
        kept.filter(([k]) => k !== key),
      );
      return false;
    }
    writeIndex(storage, kept);
    return true;
  }
  writeIndex(storage, index);
  return true;
}

/** Стереть весь кэш CRM в этом браузере — выход, 401. */
export function clearStoredCache(storage: Storage | null): void {
  if (storage === null) return;
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }
  } catch {
    return;
  }
  drop(storage, keys);
}
