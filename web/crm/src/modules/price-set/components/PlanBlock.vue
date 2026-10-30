<script setup lang="ts">
/**
 * План цен: что уйдёт на каждую площадку. Состояния — ожидание, ошибка с
 * повтором, «нечего менять»; выбор площадок и строк — снаружи
 * (usePriceSetSelection), числа и решения — с сервера.
 */
import type { PriceSetPickerOption } from '../composables/usePriceSetSelection.price-set';
import type { PriceSetMarketplace } from '../price-set.domain';

import { BadgePercent, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import { usePriceSetStore } from '../store/store.price-set';

import PriceTargetCard from './PriceTargetCard.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import MarketplacePicker from '@/modules/price-list/components/MarketplacePicker.vue';

const FILE_BAD_SHOWN = 50;

defineProps<{
  options: PriceSetPickerOption[];
  isSelected: (marketplace: PriceSetMarketplace) => boolean;
  isIncluded: (key: string) => boolean;
  countOf: (marketplace: PriceSetMarketplace) => number;
}>();
const emit = defineEmits<{
  toggle: [marketplace: PriceSetMarketplace, on: boolean];
  toggleRow: [key: string, on: boolean];
}>();

const store = usePriceSetStore();
const {
  plan,
  planLoading,
  planFailure,
  applyError,
  isApplySubmitting,
  isWriting,
  writeFailure,
  writeResult,
} = storeToRefs(store);

const busy = computed(() => isApplySubmitting.value || isWriting.value);
const hasChanges = computed(() => plan.value?.targets.some((t) => t.updates.length > 0) ?? false);
const sourceLabel = computed(() =>
  plan.value?.source === 'file' ? 'План по файлу' : 'План по наценке',
);
</script>

<template>
  <section class="flex flex-col gap-4" aria-labelledby="price-plan-title">
    <h2 id="price-plan-title" class="text-base font-semibold">
      {{ plan ? sourceLabel : 'План цен' }}
    </h2>

    <div v-if="planLoading" class="flex flex-col gap-3" aria-busy="true">
      <p class="text-sm text-muted-foreground">
        Читаю текущие цены площадок и считаю новые — это может занять минуту…
      </p>
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-48 w-full" />
    </div>

    <div v-else-if="planFailure" class="flex flex-col items-start gap-3">
      <Alert>{{ planFailure }}</Alert>
      <Button variant="outline" @click="store.retryPlan()">
        <RotateCw />
        Повторить
      </Button>
    </div>

    <template v-else-if="plan">
      <Alert v-if="isWriting">Записываю цены на площадки…</Alert>
      <Alert v-if="applyError">{{ applyError }}</Alert>
      <Alert v-if="writeFailure">{{ writeFailure }}</Alert>
      <Alert v-if="writeResult" variant="warn">
        <div class="flex flex-col gap-1">
          <span v-for="line in writeResult" :key="line">{{ line }}</span>
          <span>Посчитайте план ещё раз, чтобы увидеть новые цены.</span>
        </div>
      </Alert>

      <p v-if="!plan.writeOpen && hasChanges" class="text-sm text-muted-foreground">
        Запись цен закрыта — её открывает администратор отдельно для каждой площадки. Сейчас это
        только просмотр.
      </p>

      <section v-if="plan.fileBad.length" class="flex flex-col gap-2">
        <h3 class="text-sm font-medium">Строки файла не разобрались: {{ plan.fileBad.length }}</h3>
        <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
          <li v-for="item in plan.fileBad.slice(0, FILE_BAD_SHOWN)" :key="item.row">
            Строка {{ item.row }}<template v-if="item.sku"> · {{ item.sku }}</template> —
            {{ item.reasonText }}
          </li>
          <li v-if="plan.fileBad.length > FILE_BAD_SHOWN">
            …и ещё {{ plan.fileBad.length - FILE_BAD_SHOWN }}
          </li>
        </ul>
      </section>

      <EmptyState
        v-if="plan.targets.length === 0"
        :icon="BadgePercent"
        title="Нечего менять"
        description="Ни на одной из выбранных площадок нет товаров с новой ценой."
      />
      <template v-else>
        <MarketplacePicker
          v-if="plan.writeOpen && hasChanges"
          title="Куда записать цены"
          description="Отметьте площадки — цены уйдут только туда. Снятые в таблицах строки не запишутся."
          :options="options"
          :is-selected="isSelected"
          :disabled="busy"
          @toggle="(marketplace, on) => emit('toggle', marketplace, on)"
        />
        <PriceTargetCard
          v-for="target in plan.targets"
          :key="target.marketplace"
          :target="target"
          :count="countOf(target.marketplace)"
          :is-included="isIncluded"
          :disabled="busy"
          @toggle-row="(key, on) => emit('toggleRow', key, on)"
        />
      </template>

      <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
        <li v-for="item in plan.notConsidered" :key="item.marketplaceLabel">
          {{ item.marketplaceLabel }}: {{ item.reason }}
        </li>
        <li v-for="note in plan.notes" :key="note">{{ note }}</li>
      </ul>
    </template>
  </section>
</template>
