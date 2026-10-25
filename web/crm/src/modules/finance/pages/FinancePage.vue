<script setup lang="ts">
/**
 * «Финансы» (TASK-124): прибыль месяца по журналу Маркета со статьями до
 * операций и оригинала отчёта, движение денег с выплатами и «к получению»,
 * сверка месяца, аномалии журнала (TASK-149) и загрузка отчёта файлом (TASK-114) — под своими фичами. Месяц — общий у вкладок; грузится только открытая вкладка.
 * Ссылка с «Обзора» несёт `?from=&to=` (TASK-125): «Прибыль» считается за этот
 * период, ДДС и сверка — за месяц его начала, они помесячные.
 * Площадка — из адреса (`/ym|ozon|wb/finance`, TASK-180): все вкладки по её
 * журналу; чего у площадки нет (ДДС Ozon/WB, сверка WB, аномалии не ЯМ) —
 * причина вместо нулей, загрузка файлом — только ЯМ. Старая ссылка
 * `/ym/finance?marketplace=ozon` (TASK-137) переводится на адрес площадки.
 */
import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

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
import UnsupportedCard from '../components/UnsupportedCard.vue';
import UploadCard from '../components/UploadCard.vue';
import { useFinanceTabs } from '../composables/useFinanceTabs.finance';
import { parseFinanceMarketplace } from '../constants/marketplaces.finance';
import { toCashflowModel } from '../mappers/mapCashflow.finance';
import { monthLabel, toMonthOption, toMonthStatus } from '../mappers/mapPnl.finance';
import { useFinanceStore } from '../store/store.finance';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { sectionName } from '@/navigation.sections';
import { useMarketplace } from '@/shared/composables';
import { JournalPull, useFinanceJournal } from '@/shared/finance-journal';
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
  cashflowNote,
  discrepancies,
  discrepanciesPage,
  discrepanciesPages,
  discrepanciesLoading,
  discrepanciesError,
  discrepanciesNote,
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
  anomaliesNote,
  reviewError,
  reviewing,
  uploadSummary,
  uploadErrors,
  uploading,
} = storeToRefs(store);

// Вне площадки страница не открывается (маршрут — `/<площадка>/finance`); ЯМ — страховка.
const routeMarketplace = useMarketplace();
const marketplace = computed(() => routeMarketplace.value ?? 'ym');
store.selectMarketplace(marketplace.value);

const { open: tabs, activeKey } = useFinanceTabs(marketplace);

// Журнал выбранного периода не загружен — «Загрузить из Маркета» над вкладкой, а не нули.
const journal = useFinanceJournal(
  () => {
    const month = currentMonth.value;
    const range = selectedRange.value ?? (month ? { from: month.from, to: month.to } : null);
    return range ? { marketplace: marketplace.value, ...range } : null;
  },
  () => void store.loadMonths().then(loadTab),
);

const description = computed(() =>
  marketplace.value === 'ym'
    ? 'Прибыль по журналу операций Маркета, движение денег и сверка месяца'
    : 'Прибыль по журналу операций площадки и сверка месяца',
);

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
    const mp = marketplace.value;
    void store.loadPnl(
      range ? { from: range.from, to: range.to, marketplace: mp } : { month, marketplace: mp },
    );
  }
}

// Старая ссылка `?marketplace=` другой площадки — на её адрес, период ссылки сохраняется.
const route = useRoute();
const router = useRouter();
const linkedMarketplace = parseFinanceMarketplace(route.query.marketplace);
if (linkedMarketplace && linkedMarketplace !== marketplace.value) {
  const query = { ...route.query };
  delete query.marketplace;
  void router.replace({
    name: sectionName(linkedMarketplace, 'finance'),
    params: route.params,
    query,
  });
}
// До первой загрузки: иначе первая задача ушла бы за месяц, а не за период ссылки.
useLinkedRange((range) => store.selectRange(range), ['marketplace']);

watch([selectedMonth, selectedRange, activeKey], loadTab);

// Другая площадка тем же экраном (переключатель площадок): месяцы — её журнала.
watch(marketplace, (next) => {
  store.selectMarketplace(next);
  void store.loadMonths();
});

onMounted(async () => {
  await store.loadMonths();
  loadTab();
});
</script>

<template>
  <PageHeader title="Финансы" :description="description">
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

  <JournalPull v-if="activeKey !== 'upload'" :journal="journal" class="mb-6 max-w-4xl" />

  <div v-if="monthsError && months.length === 0" class="flex flex-col items-start gap-3">
    <Alert>{{ monthsError }}</Alert>
    <Button variant="outline" @click="store.loadMonths().then(loadTab)">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="activeKey === 'cashflow'" class="flex max-w-4xl flex-col gap-6">
    <UnsupportedCard v-if="cashflowNote" title="Движение денег" :note="cashflowNote" />
    <CashflowCard v-else :model="cashflowModel" :error="cashflowError" :loading="cashflowLoading" />
    <template v-if="cashflowModel">
      <PayoutsCard :payouts="cashflowModel.payouts" />
      <ReceivableCard :receivable="cashflowModel.receivable" />
    </template>
  </div>

  <div v-else-if="activeKey === 'audit'" class="flex max-w-4xl flex-col gap-6">
    <MonthStatusCard v-if="monthStatus" :model="monthStatus" />
    <UnsupportedCard v-if="discrepanciesNote" title="Расхождения" :note="discrepanciesNote" />
    <DiscrepanciesCard
      v-else
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
    <UnsupportedCard v-if="anomaliesNote" title="Аномалии" :note="anomaliesNote" />
    <AnomaliesCard
      v-else
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
