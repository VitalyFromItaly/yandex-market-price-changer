<script setup lang="ts">
/**
 * «Финучёт» (TASK-206) — раздел. Пока на нём журнал синхронизации (TASK-212): с какой
 * даты данные, что и когда грузилось, где сбой и пропуск, — и ручные операции реестра
 * (TASK-208), заказы и прибыль под `fin_accounting_orders` (TASK-223), сверка v2 под
 * `fin_accounting_reconcile` (TASK-228), отчёт WB «Продвижение» файлом под
 * `fin_accounting_uploads` (TASK-209), партии с остатками и режим себестоимости А/Б под
 * `fin_accounting_lots` (TASK-216), возвраты под `fin_accounting_returns` (TASK-225), панель —
 * итоги с базисом, раскрытие до операций и аналитика — под `fin_accounting_dashboard` (TASK-231),
 * история закупа v2 с исправлением прошлой цены — под зонтиком (TASK-235).
 * Разделы — вкладками (`useAccountingTabs`), монтируется только активный.
 */
import { BookOpenCheck } from 'lucide-vue-next';
import { computed, onMounted, watch } from 'vue';

import {
  ACCOUNTING_FEATURE,
  ACCOUNTING_LOTS_FEATURE,
  ACCOUNTING_ORDERS_FEATURE,
  ACCOUNTING_UPLOADS_FEATURE,
} from '../accounting.domain';
import AccountingDashboardSection from '../components/AccountingDashboardSection.vue';
import AccountingOrdersSection from '../components/AccountingOrdersSection.vue';
import AccountingReturnsSection from '../components/AccountingReturnsSection.vue';
import CostHistorySection from '../components/CostHistorySection.vue';
import LotsSection from '../components/LotsSection.vue';
import ManualOperationDialog from '../components/ManualOperationDialog.vue';
import ManualOperationHistoryDialog from '../components/ManualOperationHistoryDialog.vue';
import ManualOperationsCard from '../components/ManualOperationsCard.vue';
import ReconcileSection from '../components/ReconcileSection.vue';
import SyncStatusCard from '../components/SyncStatusCard.vue';
import WbPromotionUploadCard from '../components/WbPromotionUploadCard.vue';
import { useAccountingTabs } from '../composables/useAccountingTabs.accounting';
import {
  useManualOperationDialog,
  useManualOperationHistory,
  useManualOperationRemoval,
} from '../composables/useManualOperationDialog.accounting';
import { toManualRow } from '../mappers/mapManualOperations.accounting';
import { mapSync } from '../mappers/mapSync.accounting';
import { useAccountingStore } from '../store/store.accounting';

import { Alert } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/modules/auth/store/store.auth';

const auth = useAuthStore();
const store = useAccountingStore();
const open = computed(() => auth.me?.features[ACCOUNTING_FEATURE] === true);
// Вкладки (подфичи — только поверх зонтика) — в useAccountingTabs; здесь — блоки внутри вкладок.
const { open: tabs, activeKey } = useAccountingTabs();
const ordersOpen = computed(
  () => open.value && auth.me?.features[ACCOUNTING_ORDERS_FEATURE] === true,
);
const lotsOpen = computed(() => open.value && auth.me?.features[ACCOUNTING_LOTS_FEATURE] === true);
const uploadsOpen = computed(
  () => open.value && auth.me?.features[ACCOUNTING_UPLOADS_FEATURE] === true,
);
const view = computed(() => (store.sync ? mapSync(store.sync) : null));
const manualRows = computed(() => (store.manual?.items ?? []).map(toManualRow));

const dialog = useManualOperationDialog();
const removal = useManualOperationRemoval();
const history = useManualOperationHistory();
const byId = (id: string) => store.manual?.items.find((item) => item.id === id) ?? null;
function edit(id: string): void {
  const operation = byId(id);
  if (operation) dialog.openEdit(operation);
}
function remove(id: string): void {
  const operation = byId(id);
  if (operation) removal.ask(operation);
}
function showHistory(id: string): void {
  const operation = byId(id);
  if (operation) void history.show(operation);
}

// Журнал синхронизации лёгкий и нужен шапке («данные на …») — грузим сразу;
// ручные операции — только при входе во вкладку, как и остальные секции.
onMounted(() => {
  if (open.value) void store.load();
});
watch(
  activeKey,
  (key) => {
    if (open.value && key === 'operations' && !store.manual) void store.loadManual();
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader
    title="Финучёт"
    :description="
      view?.asOfLabel ??
      'Фактический учёт по журналу площадок: заказы, возвраты, партии себестоимости и сверка'
    "
  />

  <EmptyState
    v-if="!open"
    :icon="BookOpenCheck"
    title="Финучёт закрыт"
    description="Его открывает администратор бота. Напишите ему, если он вам нужен."
  />

  <template v-else>
    <Tabs v-model="activeKey" class="mb-6">
      <TabsList>
        <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key">
          {{ tab.label }}
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <!-- v-if, не v-show: секции грузят данные при монтировании, неактивные не должны стартовать задачи. -->
    <div class="flex flex-col gap-6">
      <AccountingDashboardSection v-if="activeKey === 'dashboard'" :can-open-order="ordersOpen" />

      <AccountingOrdersSection v-else-if="activeKey === 'orders'" />

      <!-- Карточка заказа живёт в секции заказов: без неё номера возвратов — без перехода. -->
      <AccountingReturnsSection v-else-if="activeKey === 'returns'" :can-open-order="ordersOpen" />

      <ReconcileSection v-else-if="activeKey === 'reconcile'" />

      <template v-else-if="activeKey === 'costs'">
        <LotsSection v-if="lotsOpen" />
        <CostHistorySection />
      </template>

      <template v-else-if="activeKey === 'operations'">
        <WbPromotionUploadCard v-if="uploadsOpen" />
        <Alert v-if="store.manualError">{{ store.manualError }}</Alert>
        <div v-else-if="!store.manual" class="flex flex-col gap-3">
          <Skeleton class="h-6 w-48" />
          <Skeleton class="h-32" />
        </div>
        <ManualOperationsCard
          v-else
          :rows="manualRows"
          :disabled="dialog.busy.value || removal.busy.value"
          @create="dialog.openCreate"
          @edit="edit"
          @remove="remove"
          @history="showHistory"
        />
      </template>

      <template v-else-if="activeKey === 'sync'">
        <Alert v-if="store.error">{{ store.error }}</Alert>
        <div v-else-if="store.isLoading && !view" class="grid gap-4 md:grid-cols-2">
          <Skeleton class="h-40" />
          <Skeleton class="h-40" />
        </div>
        <EmptyState
          v-else-if="view && !view.marketplaces.length"
          :icon="BookOpenCheck"
          title="Нет подключённых площадок"
          description="Подключите площадку в разделе «Подключения» — журнал начнёт загружаться по расписанию."
        />
        <section v-else-if="view" class="flex flex-col gap-3">
          <p class="text-sm text-muted-foreground">{{ view.scheduleLabel }}</p>
          <div class="grid gap-4 md:grid-cols-2">
            <SyncStatusCard v-for="row in view.marketplaces" :key="row.marketplace" :row="row" />
          </div>
        </section>
      </template>
    </div>

    <ManualOperationDialog
      v-if="store.manual"
      v-model:open="dialog.open.value"
      v-model:form="dialog.form.value"
      :title="dialog.title.value"
      :options="store.manual.options"
      :limits="store.manual.limits"
      :errors="dialog.errors.value"
      :busy="dialog.busy.value"
      @save="dialog.save"
    />
    <ConfirmDialog
      v-model:open="removal.open.value"
      title="Удалить операцию?"
      description="Операция уйдёт из списка, её история изменений сохранится."
      confirm-label="Удалить"
      destructive
      :busy="removal.busy.value"
      @confirm="removal.confirm"
    />
    <ManualOperationHistoryDialog
      v-model:open="history.open.value"
      :items="history.items.value"
      :loading="history.loading.value"
      :error="history.error.value"
    />
  </template>
</template>
