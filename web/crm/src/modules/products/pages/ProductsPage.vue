<script setup lang="ts">
/**
 * «Товары»: товары продавца с поиском и брендом и очередь карточек площадок,
 * которые автомат не сопоставил. Себестоимость считает сервер той же функцией,
 * что «Прибыль» и «Прайс».
 */
import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

import LinkDialog from '../components/LinkDialog.vue';
import ProductsTable from '../components/ProductsTable.vue';
import UnmatchedTable from '../components/UnmatchedTable.vue';
import { useLinkDialog } from '../composables/useLinkDialog.products';
import { useProductsTabs } from '../composables/useProductsTabs.products';
import { useProductsStore } from '../store/store.products';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebouncedSearch } from '@/shared/composables';

const store = useProductsStore();
const {
  listPage,
  listQuery,
  listLoading,
  listError,
  unmatchedPage,
  unmatchedLoading,
  unmatchedError,
} = storeToRefs(store);

const { open: tabs, activeKey } = useProductsTabs();
const { text: searchText } = useDebouncedSearch(listQuery.value.q, (q) => void store.search(q));
const linking = useLinkDialog();

// Данные вкладки грузятся при её открытии: очередь не нужна, пока смотрят список.
watch(
  activeKey,
  (key) => {
    if (key === 'unmatched') void store.loadUnmatched();
    else void store.loadList();
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader
    title="Товары"
    description="Себестоимость, её история и карточки площадок по каждому товару"
  />

  <Tabs v-model="activeKey" class="mb-6">
    <TabsList>
      <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key">{{ tab.label }}</TabsTrigger>
    </TabsList>
  </Tabs>

  <template v-if="activeKey === 'unmatched'">
    <div v-if="unmatchedError && !unmatchedPage" class="flex flex-col items-start gap-3">
      <Alert>{{ unmatchedError }}</Alert>
      <Button variant="outline" @click="store.loadUnmatched()">
        <RotateCw />
        Повторить
      </Button>
    </div>
    <UnmatchedTable
      v-else
      :page="unmatchedPage"
      :loading="unmatchedLoading"
      @update:page="store.loadUnmatched($event)"
      @link="linking.show"
    />
  </template>

  <template v-else>
    <div v-if="listError && !listPage" class="flex flex-col items-start gap-3">
      <Alert>{{ listError }}</Alert>
      <Button variant="outline" @click="store.loadList()">
        <RotateCw />
        Повторить
      </Button>
    </div>
    <ProductsTable
      v-else
      v-model:search="searchText"
      :page="listPage"
      :loading="listLoading"
      :query="listQuery"
      @update:page="store.goToListPage"
      @update:brand="store.filterBrand"
    />
  </template>

  <LinkDialog
    v-model:open="linking.open.value"
    v-model:selected="linking.selected.value"
    v-model:query="linking.query.value"
    :target="linking.target.value"
    :candidates="linking.candidates.value"
    :found="linking.found.value"
    :searching="linking.searching.value"
    :error="linking.error.value"
    :busy="linking.busy.value"
    @confirm="linking.confirm()"
  />
</template>
