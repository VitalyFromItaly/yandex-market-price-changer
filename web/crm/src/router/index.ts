import { createRouter, createWebHashHistory } from 'vue-router';

import { routes } from './routes';

import { useAuthGuard } from '@/modules/auth/composables/useAuthGuard.auth';
import { useMarketplaceGuard } from '@/modules/marketplaces/composables/useMarketplaceGuard.marketplaces';

/*
 * Hash history — довод админки: F5 на #/ym/stores/… не уходит на сервер, SPA-
 * fallback не нужен, а значит ему негде проглотить ошибку /api. Заодно такой
 * перезагрузке не на что получить 404, который фильтр пометил бы «scanner».
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// Вход и принудительная смена пароля (решение crm_initial_password).
router.beforeEach(useAuthGuard());
// Ozon/WB без фичи — «скоро»; после входа: профиль уже загружен.
router.beforeEach(useMarketplaceGuard());

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : null;
  document.title = title === null ? 'CRM продавца' : `${title} — CRM продавца`;
});
