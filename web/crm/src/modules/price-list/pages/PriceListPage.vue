<script setup lang="ts">
/**
 * «Прайс»: загрузка файла поставщика, запись остатков на площадки и список
 * закупа. Файл обрабатывается ТЕМ ЖЕ путём, что в боте. При открытой
 * `stock_push` файл остатки не пишет: под ним план «Передачи остатков» —
 * свой склад минус продажи — и запись на площадки, отмеченные галочками.
 */
import { RefreshCw, RotateCw, Upload } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import PurchasePricesTable from '../components/PurchasePricesTable.vue';
import PushPlanBlock from '../components/PushPlanBlock.vue';
import UploadForm from '../components/UploadForm.vue';
import UploadResult from '../components/UploadResult.vue';
import { usePriceListTabs } from '../composables/usePriceListTabs.price-list';
import { usePushSelection } from '../composables/usePushSelection.price-list';
import { useUploadForm } from '../composables/useUploadForm.price-list';
import { coverageText } from '../mappers/mapStockPush.price-list';
import { PRICE_LIST_TAB } from '../price-list.domain';
import { usePriceListStore } from '../store/store.price-list';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebouncedSearch } from '@/shared/composables';
import { useStoreKey } from '@/shared/composables';

const store = usePriceListStore();
const {
  uploadAccepted,
  uploadErrors,
  isSubmitting,
  isProcessing,
  uploadFailure,
  uploadResult,
  plan,
  planRefreshing,
  isApplySubmitting,
  isWriting,
  prices,
  pricesQuery,
  pricesLoading,
  pricesError,
} = storeToRefs(store);
const { open, active, activeKey, stockUpdateOpen, stockPushOpen, openMarketplaces } =
  usePriceListTabs();
// Файл пишет остатки сам, только когда их не пишет план по площадкам.
const fileWritesStocks = computed(() => stockUpdateOpen.value && !stockPushOpen.value);
const form = useUploadForm(fileWritesStocks, useStoreKey());
const selection = usePushSelection(plan);
const { text: searchText } = useDebouncedSearch(pricesQuery.value.q, (q) => {
  void store.searchPrices(q);
});

const onUploadTab = computed(() => active.value?.key === PRICE_LIST_TAB.UPLOAD);
const showPlan = computed(() => stockPushOpen.value && onUploadTab.value);

// Данные вкладки — при её открытии, не заранее; план — минуты чтения площадок.
watch(
  () => active.value?.key,
  (key) => {
    if (key === PRICE_LIST_TAB.PRICES) void store.loadPrices();
    if (key === PRICE_LIST_TAB.UPLOAD && stockPushOpen.value) store.ensurePlan();
  },
  { immediate: true },
);

// Новый прайс — новый свой склад: план пересчитывается от него.
watch(uploadResult, (result) => {
  if (result?.stocksByPlan) store.refreshPlan();
});

const pushConfirmOpen = ref(false);
const pushBusy = computed(() => isApplySubmitting.value || isWriting.value);
const canPush = computed(
  () => showPlan.value && plan.value?.writeOpen === true && selection.count.value > 0,
);
const coverageNote = computed(() =>
  coverageText(uploadResult.value?.purchaseCoverage ?? null, openMarketplaces.value),
);

async function confirmPush(): Promise<void> {
  await store.applyPlan(selection.marketplaces.value);
  pushConfirmOpen.value = false;
}

function queueText(ahead: number): string | null {
  return ahead > 0 ? `Перед вами в очереди файлов: ${ahead} — обработаю по порядку.` : null;
}
</script>

<template>
  <PageHeader title="Прайс" :description="active?.label">
    <template v-if="onUploadTab" #actions>
      <Button
        :variant="canPush ? 'outline' : 'default'"
        :disabled="form.file.value === null || isSubmitting || isProcessing"
        @click="form.submit()"
      >
        <Upload />
        Загрузить
      </Button>
      <Button
        v-if="canPush"
        :disabled="pushBusy || planRefreshing || isProcessing"
        @click="pushConfirmOpen = true"
      >
        <RefreshCw />
        Записать остатки ({{ selection.count.value }})
      </Button>
    </template>
    <template v-if="open.length > 1" #filters>
      <Tabs v-model="activeKey">
        <TabsList>
          <TabsTrigger v-for="tab in open" :key="tab.key" :value="tab.key">
            {{ tab.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </template>
  </PageHeader>

  <EmptyState
    v-if="!open.length"
    title="Прайс закрыт"
    description="Его открывает администратор бота. Напишите ему, если он вам нужен."
  />

  <div v-else-if="onUploadTab" class="flex flex-col gap-4">
    <UploadForm
      v-model:dry-run="form.dryRun.value"
      :file="form.file.value"
      :file-error="uploadErrors.file"
      :disabled="isSubmitting || isProcessing"
      :stock-update-open="fileWritesStocks"
      :stocks-by-plan="stockPushOpen"
      @update:file="form.selectFile"
    />

    <Alert v-if="uploadErrors.form">{{ uploadErrors.form }}</Alert>
    <Alert v-if="uploadAccepted?.warning" variant="warn" class="whitespace-pre-line">
      {{ uploadAccepted.warning }}
    </Alert>

    <div v-if="isSubmitting || isProcessing" class="flex flex-col gap-3" aria-busy="true">
      <p class="text-sm text-muted-foreground">
        {{ uploadAccepted?.progress ?? 'Отправляю файл…' }}
        <template v-if="uploadAccepted && queueText(uploadAccepted.ahead)">
          {{ queueText(uploadAccepted.ahead) }}
        </template>
      </p>
      <Skeleton class="h-48 w-full" />
    </div>

    <Alert v-else-if="uploadFailure">{{ uploadFailure }}</Alert>

    <UploadResult v-else-if="uploadResult" :result="uploadResult" :coverage-note="coverageNote" />

    <PushPlanBlock
      v-if="showPlan"
      :options="selection.options.value"
      :is-selected="selection.isSelected"
      @toggle="selection.toggle"
    />
  </div>

  <div v-else-if="pricesError" class="flex flex-col items-start gap-3">
    <Alert>{{ pricesError }}</Alert>
    <Button variant="outline" @click="store.loadPrices()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <PurchasePricesTable
    v-else
    v-model:search="searchText"
    :page="prices"
    :loading="pricesLoading"
    :query="pricesQuery.q"
    @update:page="store.goToPricesPage"
  />

  <ConfirmDialog
    v-model:open="form.confirmOpen.value"
    title="Записать остатки в Маркет?"
    description="Остатки из файла заменят текущие на Маркете, позиции без количества уйдут в ноль. Отменить это нельзя. Чтобы сначала посмотреть, что найдётся, отметьте «Только проверка»."
    confirm-label="Записать"
    :busy="isSubmitting"
    @confirm="form.confirm()"
  />

  <ConfirmDialog
    v-model:open="pushConfirmOpen"
    title="Записать остатки на площадки?"
    :description="selection.confirmDescription.value"
    confirm-label="Записать"
    :busy="pushBusy"
    @confirm="confirmPush"
  />
</template>
