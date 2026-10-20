import { readonly, ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

/*
 * Очередь — модульный ref, а не стор: тосты не принадлежат ни сессии, ни
 * магазину, и resetAllStores их чистить не должен (тост «сессия истекла»
 * обязан пережить выход).
 */
const items = ref<ToastItem[]>([]);
let nextId = 1;

function push(kind: ToastKind, title: string, description?: string): void {
  items.value = [...items.value, { id: nextId++, kind, title, description }];
}

/** `toast.success('Сохранено')` — имя действия и тоста одно и то же: «Сохранить» → «Сохранено». */
export const toast = {
  success: (title: string, description?: string): void => push('success', title, description),
  error: (title: string, description?: string): void => push('error', title, description),
  info: (title: string, description?: string): void => push('info', title, description),
};

export function useToasts() {
  function dismiss(id: number): void {
    items.value = items.value.filter((t) => t.id !== id);
  }
  return { items: readonly(items), dismiss };
}
