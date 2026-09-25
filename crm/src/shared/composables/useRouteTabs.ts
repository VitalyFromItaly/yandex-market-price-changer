import type { ComputedRef } from 'vue';

import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/** Вкладка из URL, если она открыта; иначе первая открытая; null — открытых нет. */
export function resolveTab<T extends { key: string }>(
  param: unknown,
  open: readonly T[],
): T | null {
  return open.find((tab) => tab.key === param) ?? open[0] ?? null;
}

/**
 * Активная вкладка живёт в параметре пути (`/ym/<раздел>/:<param>?`): F5 и
 * ссылка ведут в ту же вкладку. Для первой открытой параметр опускается —
 * адрес раздела остаётся адресом из меню. `replace`, не `push`: переключение
 * вкладки — не шаг истории.
 */
export function useRouteTabs<T extends { key: string }>(
  routeName: string,
  param: string,
  open: ComputedRef<readonly T[]>,
) {
  const route = useRoute();
  const router = useRouter();

  const active = computed(() => resolveTab(route.params[param], open.value));

  const activeKey = computed<T['key'] | undefined>({
    get: () => active.value?.key,
    set: (key) => {
      const isFirst = key === open.value[0]?.key;
      void router.replace({
        name: routeName,
        params: isFirst || key === undefined ? {} : { [param]: key },
      });
    },
  });

  return { active, activeKey };
}
