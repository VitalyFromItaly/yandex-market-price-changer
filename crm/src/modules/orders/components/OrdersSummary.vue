<script setup lang="ts">
/**
 * Итоги отчёта — те же строки, что сообщение бота: заказы, продажи (с долей
 * субсидий Маркета), с доставкой, FBY-сборка, разбивка возвратов, оговорки.
 */
import type { OrdersReport } from '../orders.domain';

import { Info } from 'lucide-vue-next';

import { Card, CardContent } from '@/components/ui/card';
import { SegmentBar } from '@/components/ui/chart';
import { formatCount, formatRub } from '@/shared/utils';

defineProps<{ report: OrdersReport }>();
</script>

<template>
  <Card>
    <CardContent class="flex flex-col gap-5 pt-5">
      <dl class="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div>
          <dt class="text-sm text-muted-foreground">Заказов</dt>
          <dd class="tnum mt-1 text-2xl font-semibold">{{ formatCount(report.count) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted-foreground">Продажи</dt>
          <dd class="tnum mt-1 text-2xl font-semibold">{{ formatRub(report.totals.sales) }}</dd>
          <!-- Ноль не печатаем, как бот: «субсидии 0 ₽» ничего не сообщает. -->
          <dd v-if="report.totals.subsidies" class="tnum mt-1 text-sm text-muted-foreground">
            в т.ч. субсидии Маркета: {{ formatRub(report.totals.subsidies) }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted-foreground">С доставкой</dt>
          <dd class="tnum mt-1 text-2xl font-semibold">
            {{ formatRub(report.totals.withDelivery) }}
          </dd>
        </div>
      </dl>

      <div
        v-if="report.assembling || report.returnsLine || report.notes.length"
        class="flex flex-col gap-1.5 border-t pt-4 text-sm"
      >
        <p v-if="report.assembling" class="tnum">
          Из них собирается на складе Маркета: {{ formatCount(report.assembling) }}
        </p>
        <p v-if="report.returnsLine" class="tnum">{{ report.returnsLine }}</p>
        <SegmentBar
          v-if="report.returnsSplit"
          class="max-w-md py-1"
          label="Возвраты: едут к вам и уже выданы магазину"
          :segments="[
            { key: 'inFlight', label: 'Едет', value: report.returnsSplit.inFlight, tone: 'warn' },
            {
              key: 'settled',
              label: 'Выдано магазину',
              value: report.returnsSplit.settled,
              tone: 'ok',
            },
          ]"
        />
        <p
          v-for="note in report.notes"
          :key="note"
          class="flex items-start gap-1.5 text-muted-foreground"
        >
          <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {{ note }}
        </p>
      </div>
    </CardContent>
  </Card>
</template>
