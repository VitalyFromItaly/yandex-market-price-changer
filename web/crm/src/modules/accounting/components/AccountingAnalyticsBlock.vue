<script setup lang="ts">
/**
 * Аналитика «Финучёта» (TASK-231 поверх TASK-230): заказы, оформленные в периоде, —
 * площадки рядом (без данных — причина словами), прибыль по дням рядом на площадку,
 * ТОП моделей (только однотоварные заказы — что не вошло, подписано), убыточные
 * заказы и модели возвратов. Числа — с сервера.
 */
import type { AccountingAnalyticsView, AnalyticsLossOrderRow } from '../accounting.domain';

import { Info } from 'lucide-vue-next';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart } from '@/components/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { formatRub } from '@/shared/utils';

defineProps<{ view: AccountingAnalyticsView; canOpenOrder: boolean }>();
const emit = defineEmits<{ order: [AnalyticsLossOrderRow] }>();

const SHORT = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const axisFormat = (value: number): string => SHORT.format(value);

const NUM = 'whitespace-nowrap text-right tabular-nums';
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <h3 class="text-sm font-semibold">Аналитика заказов периода</h3>
      <p class="text-sm text-muted-foreground">
        Заказы, оформленные {{ view.periodLabel }}, — по их карточкам.
      </p>
    </div>

    <Alert v-for="m in view.missing" :key="m.marketplace" variant="warn">
      {{ m.label }}: {{ m.reason }}
    </Alert>

    <template v-if="view.columns.length">
      <Card class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Площадки рядом</TableHead>
              <TableHead v-for="column in view.columns" :key="column.marketplace" :class="NUM">
                {{ column.label }}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in view.compare" :key="row.key">
              <TableCell :class="{ 'font-medium': row.total }">
                <span class="inline-flex items-center gap-1.5">
                  {{ row.title }}
                  <Tooltip v-if="row.hint" :text="row.hint">
                    <button
                      type="button"
                      class="text-muted-foreground"
                      :aria-label="`Что входит: ${row.title}`"
                    >
                      <Info class="size-3.5" aria-hidden="true" />
                    </button>
                  </Tooltip>
                </span>
              </TableCell>
              <TableCell
                v-for="(cell, index) in row.cells"
                :key="view.columns[index]?.marketplace"
                :class="[NUM, { 'font-medium': row.total }]"
              >
                {{ cell }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <Card v-if="view.points.length">
        <CardHeader class="pb-2">
          <CardTitle class="text-base">Чистая прибыль по дням оформления</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          <AreaChart
            :points="view.points"
            :series="view.series"
            :format="formatRub"
            :axis-format="axisFormat"
            gaps
            label="Чистая прибыль заказов по дням оформления, отдельная линия на каждую площадку"
          />
          <p v-if="view.unknownDaysNote" class="text-xs text-muted-foreground">
            {{ view.unknownDaysNote }}
          </p>
        </CardContent>
      </Card>

      <div class="grid gap-4 lg:grid-cols-2">
        <div
          v-for="top in [
            { key: 'most', title: 'Самые прибыльные модели', rows: view.mostProfitable },
            { key: 'least', title: 'Наименее прибыльные модели', rows: view.leastProfitable },
          ]"
          :key="top.key"
          class="flex flex-col gap-2"
        >
          <h4 class="text-sm font-semibold">{{ top.title }}</h4>
          <Card class="p-0">
            <Table>
              <TableBody>
                <TableRow v-if="!top.rows.length">
                  <TableCell class="text-sm text-muted-foreground"
                    >Нет однотоварных заказов</TableCell
                  >
                </TableRow>
                <TableRow v-for="row in top.rows" :key="row.key">
                  <TableCell class="max-w-64">
                    <div class="truncate">{{ row.name }}</div>
                    <div class="truncate text-xs text-muted-foreground">
                      {{ row.offerId
                      }}<template v-if="view.multiColumn"> · {{ row.marketplaceLabel }}</template> ·
                      {{ row.ordersLabel }}
                    </div>
                  </TableCell>
                  <TableCell :class="[NUM, { 'text-danger': row.isLoss }]">
                    {{ row.profitLabel }}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
      <ul v-if="view.productsNotes.length" class="text-xs text-muted-foreground">
        <li v-for="note in view.productsNotes" :key="note">{{ note }}</li>
      </ul>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold">Убыточные заказы</h4>
          <Card class="p-0">
            <Table>
              <TableBody>
                <TableRow v-if="!view.lossOrders.length">
                  <TableCell class="text-sm text-muted-foreground">Убыточных заказов нет</TableCell>
                </TableRow>
                <TableRow v-for="row in view.lossOrders" :key="row.key">
                  <TableCell class="max-w-64">
                    <Button
                      v-if="canOpenOrder"
                      variant="link"
                      size="sm"
                      class="h-auto p-0 font-medium"
                      @click="emit('order', row)"
                    >
                      {{ row.orderId }}
                    </Button>
                    <span v-else class="font-medium">{{ row.orderId }}</span>
                    <div class="truncate text-xs text-muted-foreground">
                      {{ row.dayLabel
                      }}<template v-if="view.multiColumn"> · {{ row.marketplaceLabel }}</template> ·
                      {{ row.title }}
                    </div>
                  </TableCell>
                  <TableCell :class="[NUM, 'text-danger']">{{ row.resultLabel }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
          <p v-if="view.lossOrdersNote" class="text-xs text-muted-foreground">
            {{ view.lossOrdersNote }}
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold">Дороже всего обходятся возвраты</h4>
          <Card class="p-0">
            <Table>
              <TableHeader v-if="view.returnModels.length">
                <TableRow>
                  <TableHead>Модель</TableHead>
                  <TableHead :class="NUM">Итог возвратов</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-if="!view.returnModels.length">
                  <TableCell class="text-sm text-muted-foreground">Возвратов нет</TableCell>
                </TableRow>
                <TableRow v-for="row in view.returnModels" :key="row.key">
                  <TableCell class="max-w-64">
                    <div class="truncate">{{ row.name }}</div>
                    <div class="truncate text-xs text-muted-foreground">
                      {{ row.offerId
                      }}<template v-if="view.multiColumn"> · {{ row.marketplaceLabel }}</template> ·
                      {{ row.returnedLabel }}
                    </div>
                  </TableCell>
                  <TableCell :class="NUM">{{ row.resultLabel }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
          <p v-if="view.returnModelsNote" class="text-xs text-muted-foreground">
            {{ view.returnModelsNote }}
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
