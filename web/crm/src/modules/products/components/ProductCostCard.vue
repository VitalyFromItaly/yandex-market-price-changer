<script setup lang="ts">
/**
 * Себестоимость товара на сегодня и закуп, из которого она получена, плюс
 * история: с какого дня действовал какой закуп, откуда он и кто правил.
 * Числа — с сервера (та же функция, что у «Прибыли»); фронт не пересчитывает.
 */
import type { ProductCard } from '../products.domain';

import { Pencil } from 'lucide-vue-next';

import { formatAuthor, formatPurchase, formatValidFrom } from '../mappers/mapProducts.products';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatRub } from '@/shared/utils';

defineProps<{ card: ProductCard; me: string | undefined; busy: boolean }>();
const emit = defineEmits<{ edit: [] }>();
</script>

<template>
  <Card>
    <CardHeader class="flex flex-row items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <CardTitle>Себестоимость</CardTitle>
        <p class="tnum text-2xl font-semibold">
          {{ card.cost === null ? 'неизвестна' : formatRub(card.cost) }}
        </p>
        <p class="text-sm text-muted-foreground">
          Закуп: {{ formatPurchase(card.purchase) }}
          <template v-if="card.brandTitle"> · скидка бренда «{{ card.brandTitle }}»</template>
        </p>
        <p v-if="card.cost === null && card.purchase !== null" class="text-sm text-warn">
          Для валюты нужен курс — без него «Прибыль» не знает себестоимость.
        </p>
      </div>
      <Button variant="outline" size="sm" :disabled="busy" @click="emit('edit')">
        <Pencil />
        Изменить закуп
      </Button>
    </CardHeader>

    <CardContent class="flex flex-col gap-3">
      <p v-if="card.history.length === 0" class="text-sm text-muted-foreground">
        Закуп не менялся с появления истории — он действует для всех продаж.
      </p>
      <Table v-else>
        <TableHeader>
          <TableRow>
            <TableHead>Действует</TableHead>
            <TableHead class="text-right">Закуп</TableHead>
            <TableHead>Источник</TableHead>
            <TableHead class="hidden sm:table-cell">Кто</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in card.history" :key="row.validFrom ?? 'baseline'">
            <TableCell class="tnum">{{ formatValidFrom(row.validFrom) }}</TableCell>
            <TableCell class="tnum text-right">{{ formatPurchase(row.purchase) }}</TableCell>
            <TableCell>
              <Badge :variant="row.source === 'manual' ? 'brand' : 'default'">
                {{ row.sourceText ?? '—' }}
              </Badge>
            </TableCell>
            <TableCell class="hidden text-muted-foreground sm:table-cell">
              {{ formatAuthor(row.author, me) }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </CardContent>
  </Card>
</template>
