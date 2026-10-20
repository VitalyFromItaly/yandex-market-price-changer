import type { StoreItem } from '../stores.domain';
import type { Ref } from 'vue';

import { watch } from 'vue';
import { useRouter } from 'vue-router';

import { DASHBOARD_ROUTE_NAME } from '@/modules/dashboard/dashboard.domain';

/**
 * Один магазин — сразу внутрь, но только при ПЕРВОМ входе в CRM за сессию
 * вкладки. Иначе пункт «Магазины» в меню никогда не открыл бы список, а на нём
 * живёт смена токена.
 */
let entered = false;

export function useSingleStoreEntry(stores: Readonly<Ref<StoreItem[] | null>>): void {
  const router = useRouter();
  watch(
    stores,
    (list) => {
      if (entered || list === null) return;
      entered = true;
      const only = list.length === 1 ? list[0] : undefined;
      if (only !== undefined) {
        void router.replace({ name: DASHBOARD_ROUTE_NAME, params: { store: only.key } });
      }
    },
    { immediate: true },
  );
}

/** Для тестов: следующий вход снова считается первым. */
export function resetSingleStoreEntry(): void {
  entered = false;
}
