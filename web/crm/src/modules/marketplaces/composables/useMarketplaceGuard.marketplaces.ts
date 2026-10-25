import type { NavigationGuard, RouteLocationRaw } from 'vue-router';

import { MARKETPLACE_UPCOMING_ROUTE_NAME } from '../pages/routes';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { isLiveMarketplace, marketplaceHome, marketplaceOfPath } from '@/navigation';

interface MarketplaceRouteTarget {
  name: unknown;
  path: string;
}

/**
 * Куда пустить на адрес Ozon/WB. Чистая функция — политика под тестом. Разделы
 * площадок — статические маршруты (ранжируются выше шаблона «скоро»), поэтому
 * живая ли площадка у продавца, проверяется здесь, на каждом переходе, по
 * `me.sections` (фича площадки), а не списком на момент загрузки:
 *  - площадка «скоро» — любой её раздел открывает страницу «скоро» (по имени
 *    маршрута, иначе адрес снова совпал бы со статическим разделом);
 *  - живая — «скоро» и раздел, закрытый своей фичей, ведут на её первый
 *    открытый раздел.
 */
export function resolveMarketplaceRoute(
  sections: string[] | null,
  to: MarketplaceRouteTarget,
): true | RouteLocationRaw {
  const mp = marketplaceOfPath(to.path);
  if (mp === null || mp === 'ym') return true;
  const live = isLiveMarketplace(mp, sections);
  if (to.name === MARKETPLACE_UPCOMING_ROUTE_NAME) {
    return live ? marketplaceHome(mp, sections) : true;
  }
  // Адрес раздела площадки — `/<mp>/<раздел>`, имя — `<mp>-<раздел>` (`sectionName`).
  const rest = to.path.split('/').slice(2).filter(Boolean);
  if (sections?.includes(`${mp}-${rest[0] ?? ''}`) === true) return true;
  if (live) return marketplaceHome(mp, sections);
  return { name: MARKETPLACE_UPCOMING_ROUTE_NAME, params: { mp, rest } };
}

/** Глобальный гард — после `useAuthGuard`: тот уже дождался профиля. */
export function useMarketplaceGuard(): NavigationGuard {
  return (to) => resolveMarketplaceRoute(useAuthStore().me?.sections ?? null, to);
}
