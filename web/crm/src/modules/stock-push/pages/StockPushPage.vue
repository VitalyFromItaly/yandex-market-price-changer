<script setup lang="ts">
/**
 * «Передача остатков» (TASK-143): свой склад из прайса минус продажи со своего
 * склада на всех площадках — и что будет записано на каждую. Запись — только
 * кнопкой и только после подтверждения, на те площадки, чья запись открыта
 * администратором (Ozon и WB — TASK-175); остальные — просмотр.
 */
import { RefreshCw, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import TargetCard from '../components/TargetCard.vue';
import { useStockPushStore } from '../store/store.stock-push';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';

const store = useStockPushStore();
const {
  data,
  isLoading,
  isRefreshing,
  savedAt,
  error,
  applyError,
  isSubmitting,
  isWriting,
  writeFailure,
  writeResult,
} = storeToRefs(store);

store.ensure();

const confirmOpen = ref(false);
const busy = computed(() => isSubmitting.value || isWriting.value);
const canWrite = computed(
  () => data.value !== null && data.value.writeOpen && data.value.writeCount > 0,
);
const confirmText = computed(() => {
  const plan = data.value;
  if (!plan) return '';
  const stores = plan.targets
    .filter((t) => t.willWrite)
    .map((t) => (t.marketplace === 'ym' ? `${t.marketplaceLabel} «${t.name}»` : `«${t.name}»`));
  return (
    `Будет записано ${plan.writeCount} позиций: ${stores.join(', ')}. ` +
    'Это изменит остатки в вашем кабинете. Перед записью план пересчитается: если числа ' +
    'изменились, ничего не запишется.'
  );
});
const hasChanges = computed(() => data.value?.targets.some((t) => t.updates.length > 0) ?? false);
const priceListDay = computed(() => {
  const day = data.value?.priceListDay;
  return day ? day.split('-').reverse().join('.') : null;
});

async function confirm(): Promise<void> {
  await store.apply();
  confirmOpen.value = false;
}
</script>

<template>
  <PageHeader
    title="Передача остатков"
    description="Свой склад минус продажи на всех площадках — и что будет записано на каждую"
  >
    <template #actions>
      <Button variant="outline" :disabled="isLoading || busy" @click="store.refresh()">
        <RotateCw />
        Обновить
      </Button>
      <Button v-if="canWrite" :disabled="busy || isRefreshing" @click="confirmOpen = true">
        <RefreshCw />
        Записать остатки
      </Button>
    </template>
  </PageHeader>

  <div v-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">
      Читаю заказы и остатки всех площадок — это может занять несколько минут…
    </p>
    <Skeleton class="h-32 w-full" />
    <Skeleton class="h-64 w-full" />
  </div>

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.refresh()"
    />

    <p class="text-sm text-muted-foreground">{{ data.ruleText }}</p>

    <Alert v-if="!priceListDay">
      Прайса с количеством ещё не было — загрузите его в разделе «Прайс» любого магазина.
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
        <span class="text-muted-foreground">Нажмите «Обновить», чтобы увидеть новые остатки.</span>
      </div>
    </Alert>

    <Alert v-for="item in data.orderErrors" :key="item.source">
      Заказы {{ item.source }} не прочитались ({{ item.error }}) — продажи неизвестны, запись
      запрещена на все площадки.
    </Alert>

    <p v-if="!data.writeOpen && hasChanges" class="text-sm text-muted-foreground">
      Запись остатков закрыта — её открывает администратор отдельно для каждой площадки. Сейчас это
      только просмотр.
    </p>

    <EmptyState
      v-if="data.targets.length === 0"
      :icon="RefreshCw"
      title="Писать некуда"
      description="Нет подключённых площадок со своим складом."
    />
    <TargetCard v-for="target in data.targets" :key="target.key" :target="target" />

    <section v-if="data.skipped.length" class="flex flex-col gap-2">
      <h2 class="text-sm font-medium">Не входят в план: {{ data.skipped.length }}</h2>
      <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
        <li v-for="item in data.skipped.slice(0, 50)" :key="item.internalSku">
          {{ item.internalSku }}<template v-if="item.name"> · {{ item.name }}</template> —
          {{ item.reasonText }}
        </li>
        <li v-if="data.skipped.length > 50">…и ещё {{ data.skipped.length - 50 }}</li>
      </ul>
    </section>

    <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
      <li v-for="item in data.notConsidered" :key="item.marketplaceLabel">
        {{ item.marketplaceLabel }}: {{ item.reason }} — её продажи не вычитаются.
      </li>
      <li v-for="note in data.notes" :key="note">{{ note }}</li>
    </ul>
  </div>

  <ConfirmDialog
    v-model:open="confirmOpen"
    title="Записать остатки на площадки?"
    :description="confirmText"
    confirm-label="Записать"
    :busy="busy"
    @confirm="confirm"
  />
</template>
