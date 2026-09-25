<script setup lang="ts">
/**
 * Карточки среза: поиск по артикулу, фильтр «требуют действий», сортировка по
 * клику на заголовок, показ порциями. Худшие по рейтингу — сверху, как в книге.
 */
import type { CardRow, CardSortKey } from '../offer-cards.domain';

import { Search } from 'lucide-vue-next';
import { toRef } from 'vue';

import { PAGE_ROWS, useCardsTable } from '../composables/useCardsTable.offer-cards';
import { CARDS_FILTERS } from '../offer-cards.domain';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
} from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { formatCount } from '@/shared/utils';

/** Сколько рекомендаций печатать в ячейке — как бот (RECOMMENDATIONS_PER_CARD). */
const SHOWN_RECOMMENDATIONS = 3;

const props = defineProps<{ rows: readonly CardRow[] }>();

const table = useCardsTable(toRef(props, 'rows'));

function sortProps(key: CardSortKey) {
  return {
    active: table.sort.value.key === key,
    direction: table.sort.value.dir,
    onSort: () => table.toggleSort(key),
  };
}

function percent(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative w-full max-w-sm">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          v-model="table.query.value"
          type="search"
          class="pl-9"
          placeholder="Артикул"
          aria-label="Поиск по артикулу"
        />
      </div>
      <OptionGroup v-model="table.filter.value" :options="CARDS_FILTERS" label="Статус карточки" />
    </div>

    <Card class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHead label="Артикул" v-bind="sortProps('offerId')" />
            <TableSortHead
              label="Статус"
              class="hidden md:table-cell"
              v-bind="sortProps('status')"
            />
            <TableSortHead label="Рейтинг" align="right" v-bind="sortProps('contentRating')" />
            <TableHead class="hidden text-right lg:table-cell">По категории</TableHead>
            <TableHead class="hidden lg:table-cell">Рекомендации</TableHead>
            <TableSortHead
              label="Ошибки"
              align="right"
              class="hidden sm:table-cell"
              v-bind="sortProps('errorsCount')"
            />
            <TableSortHead
              label="Предупреждения"
              align="right"
              class="hidden sm:table-cell"
              v-bind="sortProps('warningsCount')"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in table.visible.value" :key="row.id">
            <TableCell class="max-w-56 truncate font-medium" :title="row.offerId">
              {{ row.offerId }}
            </TableCell>
            <TableCell class="hidden md:table-cell">
              <Badge v-if="row.actionable" variant="warn">{{ row.statusLabel }}</Badge>
              <span v-else>{{ row.statusLabel }}</span>
            </TableCell>
            <TableCell class="tnum text-right">{{ percent(row.contentRating) }}</TableCell>
            <TableCell class="tnum hidden text-right text-muted-foreground lg:table-cell">
              {{ percent(row.averageContentRating) }}
            </TableCell>
            <TableCell class="hidden max-w-sm lg:table-cell">
              <span v-if="!row.recommendations.length" class="text-muted-foreground">—</span>
              <span v-else class="text-sm">
                {{ row.recommendations.slice(0, SHOWN_RECOMMENDATIONS).join('; ') }}
                <Tooltip
                  v-if="row.recommendations.length > SHOWN_RECOMMENDATIONS"
                  :text="row.recommendations.slice(SHOWN_RECOMMENDATIONS).join('; ')"
                >
                  <button
                    type="button"
                    class="tnum text-muted-foreground underline-offset-2 hover:underline"
                  >
                    +{{ row.recommendations.length - SHOWN_RECOMMENDATIONS }}
                  </button>
                </Tooltip>
              </span>
            </TableCell>
            <TableCell class="tnum hidden text-right sm:table-cell">
              {{ row.errorsCount || '—' }}
            </TableCell>
            <TableCell class="tnum hidden text-right sm:table-cell">
              {{ row.warningsCount || '—' }}
            </TableCell>
          </TableRow>
          <TableRow v-if="table.matched.value.length === 0">
            <TableCell colspan="7" class="py-8 text-center text-muted-foreground">
              Ничего не нашлось — измените запрос или фильтр.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <div v-if="table.hidden.value" class="flex items-center justify-center gap-3">
      <span class="tnum text-sm text-muted-foreground">
        Показано {{ formatCount(table.visible.value.length) }} из
        {{ formatCount(table.matched.value.length) }}
      </span>
      <Button variant="ghost" size="sm" @click="table.showMore">
        Показать ещё {{ Math.min(PAGE_ROWS, table.hidden.value) }}
      </Button>
    </div>
  </div>
</template>
