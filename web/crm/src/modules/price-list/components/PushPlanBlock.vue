<script setup lang="ts">
/**
 * План записи остатков на площадки (бывшая «Передача остатков», TASK-143):
 * свой склад из прайса минус продажи со своего склада на всех площадках — и
 * что уйдёт на каждую. Запись — кнопкой в шапке страницы, на отмеченные здесь
 * площадки; числа и решения — с сервера.
 */
import type { PushMarketplaceOption, StockPushMarketplace } from '../price-list.domain';

import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import { usePriceListStore } from '../store/store.price-list';

import MarketplacePicker from './MarketplacePicker.vue';
import TargetCard from './TargetCard.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  options: PushMarketplaceOption[];
  isSelected: (marketplace: StockPushMarketplace) => boolean;
}>();
const emit = defineEmits<{ toggle: [marketplace: StockPushMarketplace, on: boolean] }>();

const store = usePriceListStore();
const {
  plan,
  planRefreshing,
  planSavedAt,
  planError,
  applyError,
  isApplySubmitting,
  isWriting,
  writeFailure,
  writeResult,
} = storeToRefs(store);

const busy = computed(() => isApplySubmitting.value || isWriting.value);
const hasChanges = computed(() => plan.value?.targets.some((t) => t.updates.length > 0) ?? false);
const priceListDay = computed(() => {
  const day = plan.value?.priceListDay;
  return day ? day.split('-').reverse().join('.') : null;
});
</script>

<template>
  <section class="flex flex-col gap-4" aria-labelledby="push-plan-title">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="push-plan-title" class="text-base font-semibold">План записи остатков</h2>
      <Button
        variant="outline"
        size="sm"
        :disabled="plan === null || planRefreshing || busy"
        @click="store.refreshPlan()"
      >
        <RotateCw />
        Обновить план
      </Button>
    </div>

    <div v-if="planError && !plan" class="flex flex-col items-start gap-3">
      <Alert>{{ planError }}</Alert>
      <Button variant="outline" @click="store.retryPlan()">
        <RotateCw />
        Повторить
      </Button>
    </div>

    <div v-else-if="!plan" class="flex flex-col gap-3" aria-busy="true">
      <p class="text-sm text-muted-foreground">
        Читаю заказы и остатки всех площадок — это может занять несколько минут…
      </p>
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-48 w-full" />
    </div>

    <template v-else>
      <RefreshIndicator
        :refreshing="planRefreshing"
        :saved-at="planSavedAt"
        :error="planError"
        @retry="store.refreshPlan()"
      />

      <p class="text-sm text-muted-foreground">{{ plan.ruleText }}</p>
      <Alert v-if="!priceListDay">
        Прайса с количеством ещё не было — загрузите файл выше, и план посчитается от него.
      </Alert>
      <p v-else class="text-sm">
        Последний прайс: <span class="font-medium tabular-nums">{{ priceListDay }}</span
        >.
      </p>

      <Alert v-if="isWriting">Записываю остатки на площадки…</Alert>
      <Alert v-if="applyError">{{ applyError }}</Alert>
      <Alert v-if="writeFailure">{{ writeFailure }}</Alert>
      <Alert v-if="writeResult">
        <div class="flex flex-col gap-1">
          <span v-for="line in writeResult" :key="line">{{ line }}</span>
          <span class="text-muted-foreground"
            >Нажмите «Обновить план», чтобы увидеть новые остатки.</span
          >
        </div>
      </Alert>

      <Alert v-for="item in plan.orderErrors" :key="item.source">
        Заказы {{ item.source }} не прочитались ({{ item.error }}) — продажи неизвестны, запись
        запрещена на все площадки.
      </Alert>

      <p v-if="!plan.writeOpen && hasChanges" class="text-sm text-muted-foreground">
        Запись остатков закрыта — её открывает администратор отдельно для каждой площадки. Сейчас
        это только просмотр.
      </p>

      <EmptyState
        v-if="plan.targets.length === 0"
        :icon="RotateCw"
        title="Писать некуда"
        description="Нет подключённых площадок со своим складом."
      />
      <template v-else>
        <MarketplacePicker
          :options="options"
          :is-selected="isSelected"
          :disabled="busy"
          @toggle="(marketplace, on) => emit('toggle', marketplace, on)"
        />
        <TargetCard v-for="target in plan.targets" :key="target.key" :target="target" />
      </template>

      <section v-if="plan.skipped.length" class="flex flex-col gap-2">
        <h3 class="text-sm font-medium">Не входят в план: {{ plan.skipped.length }}</h3>
        <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
          <li v-for="item in plan.skipped.slice(0, 50)" :key="item.internalSku">
            {{ item.internalSku }}<template v-if="item.name"> · {{ item.name }}</template> —
            {{ item.reasonText }}
          </li>
          <li v-if="plan.skipped.length > 50">…и ещё {{ plan.skipped.length - 50 }}</li>
        </ul>
      </section>

      <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
        <li v-for="item in plan.notConsidered" :key="item.marketplaceLabel">
          {{ item.marketplaceLabel }}: {{ item.reason }} — её продажи не вычитаются.
        </li>
        <li v-for="note in plan.notes" :key="note">{{ note }}</li>
      </ul>
    </template>
  </section>
</template>
