<script setup lang="ts">
/**
 * Карточка товара: показатели строками, площадки — колонками. Числа есть
 * только у Маркета; Ozon и Wildberries — «скоро», без нулей: ноль читался бы
 * как «там не продаётся» (решение `ozon_wb_skipped_for_now`).
 */
import type { Tone, UnitSku } from '../unit-economics.domain';

import { computed } from 'vue';

import { formatShare, unitCardLines } from '../mappers/mapUnitEconomics.unit-economics';
import {
  MIN_PRICE_HINT,
  NO_COST_NOTE,
  PRICE_CALCULATOR_ROUTE,
  UNIT_PLATFORMS,
} from '../unit-economics.domain';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatKopecks } from '@/shared/utils';

const props = defineProps<{
  sku: UnitSku | null;
  periodLabel: string;
  /** Раздел «Калькулятор цен» открыт — ссылка «Рассчитать цену» с этим товаром. */
  withCalculator?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const lines = computed(() => (props.sku ? unitCardLines(props.sku) : []));

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-ok',
  danger: 'text-danger',
  muted: 'text-muted-foreground',
};

function onOpenChange(open: boolean): void {
  if (!open) emit('close');
}
</script>

<template>
  <Dialog :open="sku !== null" @update:open="onOpenChange">
    <DialogContent v-if="sku" class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ sku.name ?? sku.sku }}</DialogTitle>
        <DialogDescription>
          Артикул {{ sku.sku }} · {{ periodLabel }}
          <template v-if="sku.scheme"> · {{ sku.scheme }}</template>
        </DialogDescription>
      </DialogHeader>

      <Alert v-if="!sku.costKnown">{{ NO_COST_NOTE }}</Alert>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Показатель</TableHead>
            <TableHead
              v-for="platform in UNIT_PLATFORMS"
              :key="platform.key"
              class="text-right"
              :class="platform.ready ? '' : 'hidden sm:table-cell'"
            >
              {{ platform.label }}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="line in lines" :key="line.label">
            <TableCell :class="line.strong ? 'font-semibold' : ''">
              {{ line.label }}
              <div
                v-if="line.label === 'Минимальная цена без убытка'"
                class="text-xs font-normal text-muted-foreground"
              >
                {{ MIN_PRICE_HINT }}
              </div>
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              <div
                :class="[
                  line.strong ? 'font-semibold' : '',
                  line.tone ? TONE_CLASS[line.tone] : '',
                ]"
              >
                {{ line.ym }}
              </div>
              <div v-if="line.hint" class="text-xs text-muted-foreground">{{ line.hint }}</div>
            </TableCell>
            <TableCell
              v-for="platform in UNIT_PLATFORMS.filter((p) => !p.ready)"
              :key="platform.key"
              class="hidden text-right text-xs text-muted-foreground sm:table-cell"
            >
              скоро
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <section
        v-if="sku.schemes.length > 1"
        aria-label="По схемам работы"
        class="flex flex-col gap-2"
      >
        <h3 class="text-sm font-semibold">По схемам работы</h3>
        <ul class="flex flex-col gap-1 text-sm">
          <li
            v-for="part in sku.schemes"
            :key="part.scheme ?? 'none'"
            class="flex flex-wrap items-center gap-2"
          >
            <Badge variant="outline">{{ part.scheme ?? 'без схемы' }}</Badge>
            <span class="tabular-nums">{{ formatCount(part.units) }} шт.</span>
            <span class="tabular-nums text-muted-foreground">
              выручка {{ formatKopecks(part.revenueKopecks) }}
            </span>
            <span class="tabular-nums">прибыль {{ formatKopecks(part.netKopecks) }}</span>
          </li>
        </ul>
        <p class="text-xs text-muted-foreground">
          Строки без схемы — услуги, по которым Маркет её не указал (например, продвижение).
        </p>
      </section>

      <p v-if="sku.previous" class="text-xs text-muted-foreground">
        Прошлый период: выручка {{ formatKopecks(sku.previous.revenueKopecks) }}, рентабельность
        {{ formatShare(sku.previous.margin) }}.
      </p>

      <RouterLink
        v-if="withCalculator"
        :to="{ name: PRICE_CALCULATOR_ROUTE, query: { sku: sku.sku } }"
        class="text-sm font-medium text-link underline-offset-4 hover:underline"
      >
        Рассчитать цену для нужной прибыли
      </RouterLink>
    </DialogContent>
  </Dialog>
</template>
