<script setup lang="ts">
/**
 * «Отчёты Маркета»: вкладка отчёта → параметры → «Сформировать» → xlsx
 * Маркета. Отчёт собирает сам Маркет (минуты, у двух — квота 10 в час),
 * поэтому он заказывается кнопкой, а не при открытии вкладки.
 */
import type { MarketReportForm } from '../market-reports.domain';

import { Download, FileText, TriangleAlert } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import MarketReportFormFields from '../components/MarketReportForm.vue';
import { useMarketReportTabs } from '../composables/useMarketReportTabs.market-reports';
import { defaultForm, paramsCaption } from '../mappers/mapMarketReports.market-reports';
import { useMarketReportsStore } from '../store/store.market-reports';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStoreKey } from '@/shared/composables';
import { ReportFileState } from '@/shared/report-file';

const store = useMarketReportsStore();
const storeKey = useStoreKey();
const { options, optionsError, form, categories, categoriesLoading, categoriesError } =
  storeToRefs(store);
const { open, active, activeKey } = useMarketReportTabs();

watch(storeKey, (key) => void store.loadOptions(key), { immediate: true });
watch(
  options,
  (value) => {
    if (value) store.initForm(defaultForm(value));
  },
  { immediate: true },
);

// Категории — запрос в Маркет, только когда открыта «Конкурентная позиция».
watch(
  () => active.value?.key,
  (key) => {
    if (key === 'comp') void store.loadCategories(storeKey.value);
  },
  { immediate: true },
);

const key = computed(() => active.value?.key ?? null);
const loading = computed(() => (key.value === null ? false : store.isLoadingOf(key.value)));
const report = computed(() => (key.value === null ? null : store.reportOf(key.value)));
const requested = computed(() => (key.value === null ? null : store.requestedParams(key.value)));
const ready = computed(() => key.value !== null && store.paramsOf(key.value) !== null);
const caption = computed(() =>
  requested.value === null || options.value === null
    ? null
    : paramsCaption(requested.value, options.value, categories.value),
);

function onChange(field: keyof MarketReportForm, value: string | number): void {
  store.setField(field, value as never);
}

function generate(): void {
  if (key.value !== null) void store.generate(key.value, storeKey.value);
}

function download(): void {
  if (key.value !== null) void store.download(key.value);
}

function retry(): void {
  if (key.value !== null) void store.retry(key.value);
}
</script>

<template>
  <PageHeader title="Отчёты Маркета" description="Отчёты, которые готовит сам Маркет, xlsx-файлом">
    <template #actions>
      <Button
        variant="outline"
        :disabled="(report?.filename ?? null) === null || loading"
        @click="download"
      >
        <Download />
        Скачать xlsx
      </Button>
      <Button :disabled="!ready || loading" @click="generate">
        <FileText />
        Сформировать
      </Button>
    </template>
    <template v-if="open.length" #filters>
      <Tabs v-model="activeKey">
        <TabsList class="h-auto flex-wrap">
          <TabsTrigger v-for="tab in open" :key="tab.key" :value="tab.key">
            {{ tab.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </template>
  </PageHeader>

  <Alert v-if="optionsError">{{ optionsError }}</Alert>

  <div v-else-if="!options" class="flex flex-col gap-4" aria-busy="true">
    <Skeleton class="h-9 w-full" />
    <Skeleton class="h-32 w-full" />
  </div>

  <EmptyState
    v-else-if="!active"
    title="Отчётов нет"
    description="Для этого магазина Маркет не готовит ни одного из отчётов раздела."
  />

  <div v-else class="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle>{{ active.label }}</CardTitle>
        <CardDescription v-if="active.hourlyLimit" class="flex items-center gap-1.5">
          <TriangleAlert class="size-4 text-warn" aria-hidden="true" />
          Маркет разрешает не больше {{ active.hourlyLimit }} таких отчётов в час.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MarketReportFormFields
          :report="active.key"
          :form="form"
          :options="options"
          :categories="categories"
          :categories-loading="categoriesLoading"
          :categories-error="categoriesError"
          :disabled="loading"
          @change="onChange"
        />
      </CardContent>
    </Card>

    <ReportFileState
      :idle="requested === null"
      :loading="loading"
      :error="key === null ? null : store.errorOf(key)"
      :empty-text="report?.emptyText ?? null"
      :filename="report?.filename ?? null"
      :caption="caption"
      @retry="retry"
    />
  </div>
</template>
