<script setup lang="ts">
/**
 * «Прибыль»: две вкладки — «Прибыль» (плоская ставка комиссии) и
 * «Калькулятор» (услуги Маркета по тарифам). Обе собираются фоновой задачей
 * тем же ProfitService, что кнопки бота, поэтому числа сходятся с ботом до
 * рубля. Выгрузки нет — бот тоже присылает эти отчёты текстом.
 */
import type { ReportPeriod } from '@/shared/period';

import { Coins, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

import ProfitBreakdown from '../components/ProfitBreakdown.vue';
import ProfitNotes from '../components/ProfitNotes.vue';
import TariffServices from '../components/TariffServices.vue';
import UnknownSkusTable from '../components/UnknownSkusTable.vue';
import { useProfitTabs } from '../composables/useProfitTabs.profit';
import { PROFIT_REPORT } from '../profit.domain';
import { useProfitStore } from '../store/store.profit';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStoreKey } from '@/shared/composables';
import { PeriodPicker, useLinkedPeriod } from '@/shared/period';

const store = useProfitStore();
const storeKey = useStoreKey();
const { period, report, isRefreshing, savedAt, error } = storeToRefs(store);
const { open, active, activeKey, deepHistory, priceListOpen } = useProfitTabs();

function onPeriod(next: ReportPeriod): void {
  store.selectPeriod(next);
}

// Число с главной ведёт сюда с периодом в query — до первой загрузки.
useLinkedPeriod(onPeriod);

// Данные — при открытии, смене вкладки и периода. Прежняя задача при этом
// бросается (useJob.start), её поздний ответ не покажется.
watch(
  [() => active.value?.key, period],
  ([key]) => {
    if (key !== undefined) void store.load(key, storeKey.value);
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader title="Прибыль" :description="report?.heading ?? active?.label">
    <template v-if="open.length" #filters>
      <Tabs v-if="open.length > 1" v-model="activeKey">
        <TabsList>
          <TabsTrigger v-for="meta in open" :key="meta.key" :value="meta.key">
            {{ meta.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <PeriodPicker :model-value="period" :unlimited="deepHistory" @update:model-value="onPeriod" />
    </template>
  </PageHeader>

  <EmptyState
    v-if="!open.length"
    title="Прибыль закрыта"
    description="Её открывает администратор бота. Напишите ему, если она вам нужна."
  />

  <div v-else-if="error && !report" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!report" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">
      Считаю — заказы, закуп и возвраты; у крупного магазина это до минуты…
    </p>
    <div class="grid gap-4 lg:grid-cols-2">
      <Skeleton class="h-80 w-full" />
      <Skeleton class="h-48 w-full" />
    </div>
  </div>

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.retry()"
    />
    <EmptyState
      v-if="report.empty"
      :icon="Coins"
      :title="report.emptyText"
      :description="report.heading"
    />
    <div v-else class="flex flex-col gap-6">
      <div class="grid items-start gap-4 lg:grid-cols-2">
        <ProfitBreakdown v-if="report.breakdown" :breakdown="report.breakdown" />
        <TariffServices
          v-if="report.key === PROFIT_REPORT.TARIFF && report.services.length"
          :services="report.services"
        />
      </div>
      <ProfitNotes :lines="report.lines" :footer="report.footer" />
      <UnknownSkusTable
        v-if="report.excluded"
        :excluded="report.excluded"
        :price-list-open="priceListOpen"
      />
    </div>
  </div>
</template>
