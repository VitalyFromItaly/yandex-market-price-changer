<script setup lang="ts">
/**
 * «Платежи»: период → «Сформировать» → xlsx Маркета. Отчёт собирает сам
 * Маркет (минуты), поэтому он заказывается кнопкой, а не при открытии
 * страницы; даты периода считает сервер в момент сборки.
 */
import { Download, FileText } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, onMounted, watch } from 'vue';

import { usePaymentsStore } from '../store/store.payments';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreKey } from '@/shared/composables';
import { ReportFileState } from '@/shared/report-file';

const store = usePaymentsStore();
const storeKey = useStoreKey();
const { options, optionsError, period, report, requested, isLoading, error } = storeToRefs(store);

onMounted(() => void store.loadOptions());

// Первый вариант — по умолчанию, чтобы «Сформировать» работала сразу.
watch(
  options,
  (value) => {
    const first = value?.periods[0];
    if (period.value === null && first) store.selectPeriod(first.value);
  },
  { immediate: true },
);

const canDownload = computed(() => (report.value?.filename ?? null) !== null && !isLoading.value);
</script>

<template>
  <PageHeader
    title="Платежи"
    description="Фактические перечисления Маркета — отчёт о взаиморасчётах xlsx-файлом"
  >
    <template #actions>
      <Button variant="outline" :disabled="!canDownload" @click="store.download()">
        <Download />
        Скачать xlsx
      </Button>
      <Button :disabled="period === null || isLoading" @click="store.generate(storeKey)">
        <FileText />
        Сформировать
      </Button>
    </template>
    <template v-if="options" #filters>
      <OptionGroup
        :model-value="period"
        :options="options.periods"
        label="Период отчёта"
        :disabled="isLoading"
        @update:model-value="store.selectPeriod"
      />
    </template>
  </PageHeader>

  <Alert v-if="optionsError">{{ optionsError }}</Alert>
  <Skeleton v-else-if="!options" class="h-24 w-full" />
  <ReportFileState
    v-else
    :idle="!requested"
    :loading="isLoading"
    :error="error"
    :empty-text="report?.emptyText ?? null"
    :filename="report?.filename ?? null"
    :caption="report?.caption ?? null"
    @retry="store.retry()"
  />
</template>
