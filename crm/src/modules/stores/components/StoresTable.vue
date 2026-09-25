<script setup lang="ts">
/** Магазины токена: имя с моделью ведёт внутрь магазина, там все его отчёты. */
import type { StoreItem } from '../stores.domain';

import { ChevronRight } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DASHBOARD_ROUTE_NAME } from '@/modules/dashboard/dashboard.domain';

defineProps<{ stores: StoreItem[] }>();

const target = (store: StoreItem) => ({
  name: DASHBOARD_ROUTE_NAME,
  params: { store: store.key },
});
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Магазин</TableHead>
          <TableHead class="hidden sm:table-cell">Кабинет</TableHead>
          <TableHead>Модель</TableHead>
          <TableHead class="w-0"><span class="sr-only">Действия</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="store in stores" :key="store.key">
          <TableCell class="font-medium">
            <RouterLink :to="target(store)" class="hover:underline">{{ store.label }}</RouterLink>
          </TableCell>
          <TableCell class="hidden text-muted-foreground sm:table-cell">
            {{ store.businessName ?? '—' }}
          </TableCell>
          <TableCell>
            <Badge v-if="store.placementType" variant="outline">{{ store.placementType }}</Badge>
            <span v-else class="text-muted-foreground">неизвестна</span>
          </TableCell>
          <TableCell>
            <Button variant="ghost" size="sm" as-child>
              <RouterLink :to="target(store)" :aria-label="`Открыть ${store.label}`">
                Открыть
                <ChevronRight />
              </RouterLink>
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
