import { defineStore } from 'pinia';

import { useAccountingAnalytics } from './composables/useAccountingAnalytics.accounting';
import { useAccountingDashboard } from './composables/useAccountingDashboard.accounting';
import { useAccountingDashboardDrill } from './composables/useAccountingDashboardDrill.accounting';
import { useAccountingOrder } from './composables/useAccountingOrder.accounting';
import { useAccountingOrders } from './composables/useAccountingOrders.accounting';
import { useAccountingReturns } from './composables/useAccountingReturns.accounting';
import { useCostHistory } from './composables/useCostHistory.accounting';
import { useCostSettings } from './composables/useCostSettings.accounting';
import { useLots } from './composables/useLots.accounting';
import { useManualOperations } from './composables/useManualOperations.accounting';
import { useReconcile } from './composables/useReconcile.accounting';
import { useSyncStatus } from './composables/useSyncStatus.accounting';
import { useWbPromotionUpload } from './composables/useWbPromotionUpload.accounting';

/**
 * Стор раздела «Финучёт» — фасад: журнал синхронизации (TASK-212), ручные операции
 * (TASK-208), сверка v2 (TASK-228), заказы месяца и карточка заказа (TASK-223), отчёт WB
 * «Продвижение» файлом (TASK-209), партии с остатками и режим себестоимости А/Б (TASK-216), возвраты месяца (TASK-225),
 * панель, раскрытие строки и аналитика (TASK-231), история закупа v2 (TASK-235).
 */
export const useAccountingStore = defineStore('accounting', () => {
  const sync = useSyncStatus();
  const manual = useManualOperations();
  const reconcile = useReconcile();
  const orders = useAccountingOrders();
  const order = useAccountingOrder();
  const returns = useAccountingReturns();
  const wbPromotion = useWbPromotionUpload();
  const lots = useLots();
  const costSettings = useCostSettings();
  const dashboard = useAccountingDashboard();
  const drill = useAccountingDashboardDrill();
  const analytics = useAccountingAnalytics();
  const costHistory = useCostHistory();
  const { reset: resetSync, ...syncRest } = sync;
  const { reset: resetManual, ...manualRest } = manual;
  const { reset: resetReconcile, ...reconcileRest } = reconcile;
  const { reset: resetOrders, ...ordersRest } = orders;
  const { reset: resetOrder, ...orderRest } = order;
  const { reset: resetReturns, ...returnsRest } = returns;
  const { reset: resetWbPromotion, ...wbPromotionRest } = wbPromotion;
  const { reset: resetLots, ...lotsRest } = lots;
  const { reset: resetCostSettings, ...costSettingsRest } = costSettings;
  const { reset: resetDashboard, ...dashboardRest } = dashboard;
  const { reset: resetDrill, ...drillRest } = drill;
  const { reset: resetAnalytics, ...analyticsRest } = analytics;
  const { reset: resetCostHistory, ...costHistoryRest } = costHistory;
  return {
    ...syncRest,
    ...manualRest,
    ...reconcileRest,
    ...ordersRest,
    ...orderRest,
    ...returnsRest,
    ...wbPromotionRest,
    ...lotsRest,
    ...costSettingsRest,
    ...dashboardRest,
    ...drillRest,
    ...analyticsRest,
    ...costHistoryRest,
    reset() {
      resetSync();
      resetManual();
      resetReconcile();
      resetOrders();
      resetOrder();
      resetReturns();
      resetWbPromotion();
      resetLots();
      resetCostSettings();
      resetDashboard();
      resetDrill();
      resetAnalytics();
      resetCostHistory();
    },
  };
});
