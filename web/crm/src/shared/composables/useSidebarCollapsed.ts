import type { Ref } from 'vue';

import { readonly, ref } from 'vue';

/**
 * Свёрнут ли левый сайдбар на десктопе (только иконки). Удобство этого
 * браузера — в localStorage, как тема; хранилища нет — состояние живёт до
 * перезагрузки. На телефоне не действует: там меню выезжает по кнопке.
 */
export const SIDEBAR_STORAGE_KEY = 'crm.sidebar.collapsed';

export const readCollapsed = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const writeCollapsed = (value: boolean): void => {
  try {
    if (value) globalThis.localStorage?.setItem(SIDEBAR_STORAGE_KEY, '1');
    else globalThis.localStorage?.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // Нет хранилища — не повод падать.
  }
};

export interface UseSidebarCollapsed {
  collapsed: Readonly<Ref<boolean>>;
  toggle: () => void;
}

export function useSidebarCollapsed(): UseSidebarCollapsed {
  const collapsed = ref(readCollapsed());
  const toggle = (): void => {
    collapsed.value = !collapsed.value;
    writeCollapsed(collapsed.value);
  };
  return { collapsed: readonly(collapsed), toggle };
}
