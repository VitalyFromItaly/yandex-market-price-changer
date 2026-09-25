<script setup lang="ts">
/**
 * «Прайс»: загрузка файла поставщика (остатки + закупочные цены) и список
 * закупа. Файл обрабатывается ТЕМ ЖЕ путём, что в боте — одни барьеры записи,
 * одна очередь, один отчёт; здесь только ввод и показ.
 */
import { RotateCw, Upload } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

import PurchasePricesTable from '../components/PurchasePricesTable.vue';
import UploadForm from '../components/UploadForm.vue';
import UploadResult from '../components/UploadResult.vue';
import { useDebouncedSearch } from '../composables/useDebouncedSearch.price-list';
import { usePriceListTabs } from '../composables/usePriceListTabs.price-list';
import { useUploadForm } from '../composables/useUploadForm.price-list';
import { PRICE_LIST_TAB } from '../price-list.domain';
import { usePriceListStore } from '../store/store.price-list';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStoreKey } from '@/shared/composables';

const store = usePriceListStore();
const {
  uploadAccepted,
  uploadErrors,
  isSubmitting,
  isProcessing,
  uploadFailure,
  uploadResult,
  prices,
  pricesQuery,
  pricesLoading,
  pricesError,
} = storeToRefs(store);
const { open, active, activeKey, stockUpdateOpen } = usePriceListTabs();
const form = useUploadForm(stockUpdateOpen, useStoreKey());
const { text: searchText } = useDebouncedSearch(pricesQuery.value.q, (q) => {
  void store.searchPrices(q);
});

// Список закупа — при открытии его вкладки, не заранее.
watch(
  () => active.value?.key,
  (key) => {
    if (key === PRICE_LIST_TAB.PRICES) void store.loadPrices();
  },
  { immediate: true },
);

function queueText(ahead: number): string | null {
  return ahead > 0 ? `Перед вами в очереди файлов: ${ahead} — обработаю по порядку.` : null;
}
</script>

<template>
  <PageHeader title="Прайс" :description="active?.label">
    <template v-if="active?.key === PRICE_LIST_TAB.UPLOAD" #actions>
      <Button
        :disabled="form.file.value === null || isSubmitting || isProcessing"
        @click="form.submit()"
      >
        <Upload />
        Загрузить
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

  <div v-else-if="active?.key === PRICE_LIST_TAB.UPLOAD" class="flex flex-col gap-4">
    <UploadForm
      v-model:dry-run="form.dryRun.value"
      :file="form.file.value"
      :file-error="uploadErrors.file"
      :disabled="isSubmitting || isProcessing"
      :stock-update-open="stockUpdateOpen"
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

    <UploadResult v-else-if="uploadResult" :result="uploadResult" />
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
</template>
