<script setup lang="ts">
/**
 * «Налоги»: режим налогообложения, ставка и дата признания дохода. Финансовый
 * отчёт считает по ним налог от дохода до комиссий площадки. Вкладка «Год»
 * (TASK-146, фича `tax_year`) — налоговый модуль ИП: доход с начала года,
 * авансы, уменьшения, лимиты, прогноз и сверка с бухгалтерией.
 */
import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';

import TaxSettingsForm from '../components/TaxSettingsForm.vue';
import TaxYearTab from '../components/TaxYearTab.vue';
import { useTaxesTabs } from '../composables/useTaxesTabs.taxes';
import { useTaxesStore } from '../store/store.taxes';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const store = useTaxesStore();
const { view, error } = storeToRefs(store);
const { open: tabs, active, activeKey } = useTaxesTabs();

onMounted(() => {
  void store.load();
});
</script>

<template>
  <PageHeader title="Налоги" description="Режим, ставка, дата признания дохода и налоговый год" />

  <Tabs v-if="tabs.length > 1" v-model="activeKey" class="mb-6">
    <TabsList>
      <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key">{{ tab.label }}</TabsTrigger>
    </TabsList>
  </Tabs>

  <TaxYearTab v-if="active?.key === 'year'" />

  <template v-else>
    <div v-if="error && !view" class="flex flex-col items-start gap-3">
      <Alert>{{ error }}</Alert>
      <Button variant="outline" @click="store.load()">
        <RotateCw />
        Повторить
      </Button>
    </div>

    <div v-else-if="!view" class="flex max-w-2xl flex-col gap-6" aria-busy="true">
      <Skeleton class="h-48 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>

    <div v-else class="max-w-2xl">
      <TaxSettingsForm :view="view" />
    </div>
  </template>
</template>
