<script setup lang="ts">
/**
 * Очередь «не сопоставлено»: карточки площадок, для которых автомат не нашёл
 * товар или нашёл несколько. Причина — словами сервера; «Привязать» открывает
 * выбор товара.
 */
import type { UnmatchedCard, UnmatchedPage } from '../products.domain';

import { Link2, PartyPopper } from 'lucide-vue-next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
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
import { ALL_MARKETPLACES } from '@/navigation';
import { formatMoscowDate } from '@/shared/utils';

defineProps<{ page: UnmatchedPage | null; loading: boolean }>();
const emit = defineEmits<{ 'update:page': [page: number]; link: [card: UnmatchedCard] }>();

/** Подпись площадки — из общего списка навигации, а не копией. */
const marketplaceLabel = (key: string) =>
  ALL_MARKETPLACES.find((marketplace) => marketplace.key === key)?.label ?? key;
</script>

<template>
  <div class="flex flex-col gap-4">
    <Skeleton v-if="!page" class="h-64 w-full" aria-busy="true" />

    <EmptyState
      v-else-if="page.total === 0"
      :icon="PartyPopper"
      title="Все карточки сопоставлены"
      description="Каждая карточка площадки привязана к товару. Новые появятся здесь после сверки каталога."
    />

    <template v-else>
      <Card class="p-0" :aria-busy="loading">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Карточка</TableHead>
              <TableHead class="hidden md:table-cell">Название</TableHead>
              <TableHead>Причина</TableHead>
              <TableHead class="hidden lg:table-cell">Найдена</TableHead>
              <TableHead class="w-0"><span class="sr-only">Действия</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="card in page.items" :key="`${card.marketplace}:${card.sku}`">
              <TableCell>
                <div class="font-mono text-sm">{{ card.sku }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ marketplaceLabel(card.marketplace) }}
                </div>
              </TableCell>
              <TableCell class="hidden max-w-xs truncate md:table-cell">
                {{ card.name ?? '—' }}
              </TableCell>
              <TableCell>
                <Badge variant="warn">{{ card.reasonText }}</Badge>
                <span v-if="card.levelText" class="ml-2 text-xs text-muted-foreground">
                  по: {{ card.levelText }}
                </span>
              </TableCell>
              <TableCell class="tnum hidden text-muted-foreground lg:table-cell">
                {{ formatMoscowDate(card.detectedAt) ?? '—' }}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" :disabled="loading" @click="emit('link', card)">
                  <Link2 />
                  Привязать
                </Button>
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
