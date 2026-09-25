import type { Ref } from 'vue';

import { readonly, ref } from 'vue';

/**
 * Тема CRM: выбор продавца (`system` | `light` | `dark`) и то, что реально
 * включено на <html> атрибутом `data-theme`.
 *
 * «Как в системе» разрешается здесь, через matchMedia, а не в CSS
 * (`@media (prefers-color-scheme)`): тогда тёмные токены в index.css — один
 * блок под `[data-theme='dark']`, а не две копии, которые разошлись бы.
 * Инлайн-скрипт в index.html делает то же до первой отрисовки — иначе
 * тёмная ОС видит вспышку светлой страницы на каждой перезагрузке. Ключ и
 * правило там повторены намеренно (скрипт выполняется до бандла), держите
 * их одинаковыми: `THEME_STORAGE_KEY`.
 *
 * Выбор — в localStorage, а не в sessionStorage, как сессия: тема — удобство
 * этого браузера, её не надо выбирать заново в каждой вкладке. Хранилища может
 * не быть (приватный режим, запрет сайта) — тогда выбор живёт в памяти.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'crm.theme';
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

export const isThemePreference = (value: unknown): value is ThemePreference =>
  PREFERENCES.includes(value as ThemePreference);

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): ResolvedTheme => {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
};

export const readPreference = (): ThemePreference => {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
};

const writePreference = (preference: ThemePreference): void => {
  try {
    if (preference === 'system') globalThis.localStorage?.removeItem(THEME_STORAGE_KEY);
    else globalThis.localStorage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Нет хранилища — выбор проживёт до перезагрузки, это не повод падать.
  }
};

const media = (): MediaQueryList | null => globalThis.matchMedia?.(DARK_QUERY) ?? null;

const apply = (theme: ResolvedTheme): void => {
  globalThis.document?.documentElement.setAttribute('data-theme', theme);
};

/* Один экземпляр на приложение: тема общая, переключатели в сайдбаре и на входе видят одно. */
const preference = ref<ThemePreference>(readPreference());
const resolved = ref<ResolvedTheme>(resolveTheme(preference.value, media()?.matches ?? false));
let listening = false;

const sync = (): void => {
  resolved.value = resolveTheme(preference.value, media()?.matches ?? false);
  apply(resolved.value);
};

export interface UseTheme {
  preference: Readonly<Ref<ThemePreference>>;
  resolved: Readonly<Ref<ResolvedTheme>>;
  setPreference: (next: ThemePreference) => void;
}

export function useTheme(): UseTheme {
  if (!listening) {
    listening = true;
    // Смена темы ОС на лету — только в режиме «как в системе»; sync это и проверяет.
    media()?.addEventListener('change', sync);
    sync();
  }
  return {
    preference: readonly(preference),
    resolved: readonly(resolved),
    setPreference: (next) => {
      preference.value = next;
      writePreference(next);
      sync();
    },
  };
}
