<script setup lang="ts">
/**
 * «Финансы» (TASK-124): прибыль месяца по журналу Маркета со статьями до
 * операций и оригинала отчёта, движение денег с выплатами и «к получению»,
 * сверка месяца, аномалии журнала (TASK-149) и загрузка отчёта файлом (TASK-114) — под своими фичами. Месяц — общий у вкладок; грузится только открытая вкладка.
 * Ссылка с «Обзора» несёт `?from=&to=` (TASK-125): «Прибыль» считается за этот
 * период, ДДС и сверка — за месяц его начала, они помесячные.
 * Ссылка «Сравнения площадок» (TASK-137) несёт ещё `?marketplace=`: «Прибыль»
 * считается по журналу этой площадки; ДДС, сверка и загрузка — только ЯМ.
 */
import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';

import AnomaliesCard from '../components/AnomaliesCard.vue';
import CashflowCard from '../components/CashflowCard.vue';
import CorrectionsCard from '../components/CorrectionsCard.vue';
import DiscrepanciesCard from '../components/DiscrepanciesCard.vue';
import FlatEstimateCard from '../components/FlatEstimateCard.vue';
import MonthPicker from '../components/MonthPicker.vue';
import MonthStatusCard from '../components/MonthStatusCard.vue';
import PayoutsCard from '../components/PayoutsCard.vue';
import PnlArticlesCard from '../components/PnlArticlesCard.vue';
import PnlSummaryCard from '../components/PnlSummaryCard.vue';
import ReceivableCard from '../components/ReceivableCard.vue';
import UploadCard from '../components/UploadCard.vue';
import { useFinanceTabs } from '../composables/useFinanceTabs.finance';
import {
  FINANCE_MARKETPLACE_OPTIONS,
  parseFinanceMarketplace,
} from '../constants/marketplaces.finance';
import { toCashflowModel } from '../mappers/mapCashflow.finance';
import { monthLabel, toMonthOption, toMonthStatus } from '../mappers/mapPnl.finance';
import { useFinanceStore } from '../store/store.finance';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { ArticleOperationsDialog } from '@/shared/finance-operations';
import { rangeLabel, useLinkedRange } from '@/shared/period';

const store = useFinanceStore();
const {
  months,
  selectedMonth,
  selectedRange,
  currentMonth,
  monthsError,
  pnl,
  pnlMarketplace,
  pnlRefreshing,
  pnlSavedAt,
  pnlError,
  article,
  operations,
  operationsPage,
  operationsPages,
  operationsLoading,
  operationsError,
  downloadError,
  cashflow,
  cashflowLoading,
  cashflowError,
  discrepancies,
  discrepanciesPage,
  discrepanciesPages,
  discrepanciesLoading,
  discrepanciesError,
  corrections,
  correctionsPage,
  correctionsPages,
  correctionsLoading,
  correctionsError,
  anomalies,
  anomaliesLoading,
  anomaliesPage,
  anomaliesPages,
  anomaliesFilter,
  anomaliesError,
  reviewError,
  reviewing,
  uploadSummary,
  uploadErrors,
  uploading,
} = storeToRefs(store);

const { open: tabs, activeKey } = useFinanceTabs();

const monthOptions = computed(() => months.value.map(toMonthOption));
const monthStatus = computed(() => (currentMonth.value ? toMonthStatus(currentMonth.value) : null));
const cashflowModel = computed(() => (cashflow.value ? toCashflowModel(cashflow.value) : null));

const pickerRangeLabel = computed(() =>
  selectedRange.value ? rangeLabel(selectedRange.value) : null,
);

function loadTab(): void {
  const month = selectedMonth.value;
  if (month === null) return;
  const range = selectedRange.value;
  if (activeKey.value === 'cashflow') void store.loadCashflow(month);
  else if (activeKey.value === 'audit') void store.loadAudit(month);
  else if (activeKey.value === 'anomalies') void store.loadAnomalies(month);
  else if (activeKey.value === 'upload') return;
  else {
    const marketplace = pnlMarketplace.value;
    void store.loadPnl(
      range ? { from: range.from, to: range.to, marketplace } : { month, marketplace },
    );
  }
}

// Площадки «Прибыли»: ЯМ всегда, Ozon и WB — при открытых функциях площадок.
const auth = useAuthStore();
const marketplaceOptions = computed(() =>
  FINANCE_MARKETPLACE_OPTIONS.filter(
    (option) => option.value === 'ym' || auth.me?.features?.[option.value] === true,
  ),
);

// До первой загрузки: иначе первая задача ушла бы за месяц, а не за период ссылки.
const route = useRoute();
const linkedMarketplace = parseFinanceMarketplace(route.query.marketplace);
if (linkedMarketplace) store.selectPnlMarketplace(linkedMarketplace);
useLinkedRange((range) => store.selectRange(range), ['marketplace']);

watch([selectedMonth, selectedRange, activeKey, pnlMarketplace], loadTab);

onMounted(async () => {
  await store.loadMonths();
  loadTab();
});
</script>

<template>
  <PageHeader
    title="Финансы"
    description="Прибыль по журналу операций Маркета, движение денег и сверка месяца"
  >
    <template #actions>
      <MonthPicker
        :options="monthOptions"
        :model-value="selectedMonth"
        :range-label="activeKey === 'pnl' ? pickerRangeLabel : null"
        @update:model-value="store.selectMonth($event)"
      />
    </template>
  </PageHeader>

  <Tabs v-model="activeKey" class="mb-6">
    <TabsList>
      <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key">{{ tab.label }}</TabsTrigger>
    </TabsList>
  </Tabs>

  <div v-if="monthsError && months.length === 0" class="flex flex-col items-start gap-3">
    <Alert>{{ monthsError }}</Alert>
    <Button variant="outline" @click="store.loadMonths().then(loadTab)">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="activeKey === 'cashflow'" class="flex max-w-4xl flex-col gap-6">
    <CashflowCard :model="cashflowModel" :error="cashflowError" :loading="cashflowLoading" />
    <template v-if="cashflowModel">
      <PayoutsCard :payouts="cashflowModel.payouts" />
      <ReceivableCard :receivable="cashflowModel.receivable" />
    </template>
  </div>

  <div v-else-if="activeKey === 'audit'" class="flex max-w-4xl flex-col gap-6">
    <MonthStatusCard v-if="monthStatus" :model="monthStatus" />
    <DiscrepanciesCard
      :rows="discrepancies ? discrepancies.items : null"
      :total="discrepancies ? discrepancies.total : 0"
      :page="discrepanciesPage"
      :pages="discrepanciesPages"
      :loading="discrepanciesLoading"
      :error="discrepanciesError"
      @page="store.turnDiscrepancies($event)"
    />
    <CorrectionsCard
      :rows="corrections ? corrections.items : null"
      :page="correctionsPage"
      :pages="correctionsPages"
      :loading="correctionsLoading"
      :error="correctionsError"
      @page="store.turnCorrections($event)"
    />
  </div>

  <div v-else-if="activeKey === 'anomalies'" class="flex max-w-4xl flex-col gap-6">
    <AnomaliesCard
      :model="anomalies"
      :filter="anomaliesFilter"
      :page="anomaliesPage"
      :pages="anomaliesPages"
      :loading="anomaliesLoading"
      :error="anomaliesError"
      :review-error="reviewError"
      :reviewing="reviewing"
      @page="store.turnAnomalies($event)"
      @filter="store.filterAnomalies($event)"
      @review="(key, reviewed) => store.reviewAnomaly(key, reviewed)"
      @open="
        store.openArticle({
          title: $event.label,
          amount: $event.amount ?? '',
          operationIds: $event.operationIds,
        })
      "
    />
  </div>

  <div v-else-if="activeKey === 'upload'" class="flex max-w-4xl flex-col gap-6">
    <UploadCard
      :month-label="selectedMonth ? monthLabel(selectedMonth) : null"
      :summary="uploadSummary"
      :errors="uploadErrors"
      :uploading="uploading"
      @upload="store.uploadToSelectedMonth($event)"
      @clear-file-error="store.clearUploadFileError()"
    />
  </div>

  <div v-else class="flex max-w-4xl flex-col gap-6">
    <OptionGroup
      v-if="marketplaceOptions.length > 1"
      :model-value="pnlMarketplace"
      :options="marketplaceOptions"
      label="Площадка"
      @update:model-value="store.selectPnlMarketplace($event)"
    />
    <div v-if="pnlError && !pnl" class="flex flex-col items-start gap-3">
      <Alert>{{ pnlError }}</Alert>
      <Button variant="outline" @click="store.retryPnl()">
        <RotateCw />
        Повторить
      </Button>
    </div>
    <template v-else-if="!pnl">
      <Skeleton class="h-72 w-full" aria-busy="true" />
      <Skeleton class="h-48 w-full" />
    </template>
    <template v-else>
      <RefreshIndicator
        :refreshing="pnlRefreshing"
        :saved-at="pnlSavedAt"
        :error="pnlError"
        @retry="store.retryPnl()"
      />
      <PnlSummaryCard :model="pnl" />
      <FlatEstimateCard v-if="pnl.flat" :flat="pnl.flat" />
      <PnlArticlesCard
        :sections="pnl.sections"
        @open="
          store.openArticle({
            title: $event.title,
            amount: $event.amount,
            operationIds: $event.operationIds,
            article: $event.article,
          })
        "
      />
    </template>
  </div>

  <ArticleOperationsDialog
    :article="article"
    :rows="operations"
    :page="operationsPage"
    :pages="operationsPages"
    :loading="operationsLoading"
    :error="operationsError"
    :download-error="downloadError"
    @close="store.closeArticle()"
    @page="store.loadOperationsPage($event)"
    @download="store.downloadOriginal($event)"
  />
</template>
