<script setup lang="ts">
/**
 * Товары продавца: поиск по артикулам и названию, фильтр по бренду, страницы
 * по 50. Себестоимость — то, чем считают «Прибыль» и «Прайс» (считает
 * сервер); строка ведёт в карточку товара.
 */
import type { ProductsPage, ProductsQuery } from '../products.domain';

import { Search } from 'lucide-vue-next';
import { computed } from 'vue';

import { formatPurchase } from '../mappers/mapProducts.products';
import { PRODUCT_ROUTE_NAME } from '../products.domain';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatRub } from '@/shared/utils';

const props = defineProps<{ page: ProductsPage | null; loading: boolean; query: ProductsQuery }>();
const search = defineModel<string>('search', { default: '' });
const emit = defineEmits<{ 'update:page': [page: number]; 'update:brand': [brand: string] }>();

const brandOptions = computed(() => [
  { value: '', label: 'Все' },
  ...(props.page?.brands ?? []).map((brand) => ({
    value: brand.key,
    label: `${brand.title} · ${formatCount(brand.count)}`,
  })),
]);
const filtered = computed(() => props.query.q.length > 0 || props.query.brand.length > 0);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Input
        v-model="search"
        type="search"
        class="max-w-sm"
        placeholder="Артикул или название"
        aria-label="Поиск по артикулу или названию"
      />
      <p v-if="page" class="tnum text-sm text-muted-foreground">
        Товаров: {{ formatCount(page.total) }}
        <template v-if="filtered"> из {{ formatCount(page.totalAll) }}</template>
      </p>
    </div>

    <OptionGroup
      v-if="page && page.brands.length > 1"
      label="Бренд"
      :model-value="query.brand"
      :options="brandOptions"
      :disabled="loading"
      @update:model-value="emit('update:brand', $event)"
    />

    <Skeleton v-if="!page" class="h-96 w-full" aria-busy="true" />

    <EmptyState
      v-else-if="page.totalAll === 0"
      title="Товаров пока нет"
      description="Они появятся после загрузки прайса в разделе «Прайс» или сверки каталога Маркета."
    />

    <EmptyState
      v-else-if="page.total === 0"
      :icon="Search"
      title="Ничего не нашлось"
      description="Ни артикул, ни название не подходят под поиск и бренд. Сбросьте фильтр."
    />

    <template v-else>
      <Card class="p-0" :aria-busy="loading">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Артикул</TableHead>
              <TableHead class="hidden md:table-cell">Название</TableHead>
              <TableHead class="hidden lg:table-cell">Бренд</TableHead>
              <TableHead class="hidden text-right sm:table-cell">Закуп</TableHead>
              <TableHead class="text-right">Себестоимость</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="item in page.items" :key="item.id">
              <TableCell class="font-mono text-sm">
                <RouterLink
                  :to="{ name: PRODUCT_ROUTE_NAME, params: { id: item.id } }"
                  class="text-primary hover:underline"
                >
                  {{ item.internalSku }}
                </RouterLink>
              </TableCell>
              <TableCell class="hidden max-w-xs truncate md:table-cell">
                {{ item.name ?? '—' }}
              </TableCell>
              <TableCell class="hidden text-muted-foreground lg:table-cell">
                {{ item.brandTitle ?? '—' }}
              </TableCell>
              <TableCell class="tnum hidden text-right text-muted-foreground sm:table-cell">
                {{ formatPurchase(item.purchase) }}
              </TableCell>
              <TableCell class="tnum text-right">
                {{ item.cost === null ? 'нет закупа' : formatRub(item.cost) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
      <Pagination
        :page="page.page"
        :pages="page.pages"
        :disabled="loading"
        @update:page="emit('update:page', $event)"
      />
    </template>
  </div>
</template>
