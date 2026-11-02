<script setup lang="ts">
/**
 * «Синхронизация сразу после заказа»: адрес уведомлений для кабинета площадки.
 * Ozon подключается кнопкой (подписка через Seller API), ручные шаги — запасной
 * путь; у Маркета подписку через API не поставить — только шаги. Только
 * подключённые площадки; WB уведомлений не шлёт. «Сменить адрес» — если адрес утёк.
 */
import type { PushEvents } from '../stock-push.domain';

import { Copy, RefreshCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref } from 'vue';

import { useStockPushStore } from '../store/store.stock-push';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { useMarketplacesStore } from '@/modules/marketplaces/store/store.marketplaces';

const props = defineProps<{ events: PushEvents }>();

const store = useStockPushStore();
const { ozonPush, isOzonBusy, isRotating } = storeToRefs(store);
const marketplaces = useMarketplacesStore();
const targets = computed(() =>
  props.events.targets.filter((target) => marketplaces.connectionOf(target.marketplace)?.connected),
);
const ozonShown = computed(() => targets.value.some((target) => target.marketplace === 'ozon'));
const rotateOpen = ref(false);

onMounted(() => {
  if (!props.events.unavailable && ozonShown.value && !ozonPush.value) void store.loadOzonPush();
});

async function copy(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Адрес скопирован');
  } catch {
    toast.error('Не удалось скопировать', 'Выделите адрес и скопируйте вручную');
  }
}

async function rotate(): Promise<void> {
  await store.rotateSecret();
  rotateOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-4 border-t pt-4">
    <div class="flex flex-col gap-1">
      <span class="text-sm font-medium">Синхронизация сразу после заказа</span>
      <p class="max-w-prose text-sm text-muted-foreground">{{ events.about }}</p>
    </div>

    <Alert v-if="events.unavailable" variant="warn">{{ events.unavailable }}</Alert>

    <template v-else>
      <div v-for="target in targets" :key="target.marketplace" class="flex flex-col gap-2">
        <span class="text-sm font-medium">{{ target.title }}</span>

        <div v-if="target.marketplace === 'ozon'" class="flex flex-wrap items-center gap-3">
          <p
            class="text-sm"
            :class="{ 'text-danger': ozonPush && !ozonPush.ok && ozonPush.state !== 'none' }"
          >
            {{ ozonPush?.text ?? 'Проверяю уведомления Ozon…' }}
          </p>
          <Button
            v-if="
              ozonPush &&
              ozonPush.state !== 'occupied' &&
              !(ozonPush.state === 'connected' && ozonPush.ok)
            "
            size="sm"
            :disabled="isOzonBusy"
            @click="store.connectOzonPush()"
          >
            Подключить
          </Button>
        </div>

        <details v-if="target.marketplace === 'ozon'" class="text-sm text-muted-foreground">
          <summary class="cursor-pointer">Подключить вручную в кабинете Ozon</summary>
          <ol class="mt-2 list-decimal pl-5">
            <li v-for="(step, index) in target.steps" :key="index">{{ step }}</li>
          </ol>
        </details>
        <ol v-else class="list-decimal pl-5 text-sm text-muted-foreground">
          <li v-for="(step, index) in target.steps" :key="index">{{ step }}</li>
        </ol>

        <div v-if="target.url" class="flex items-center gap-2">
          <code
            class="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs"
            :title="target.url"
          >
            {{ target.url }}
          </code>
          <Button variant="outline" size="sm" @click="copy(target.url)">
            <Copy />
            Скопировать
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          {{
            target.lastEventLabel
              ? `Последнее уведомление о заказе — ${target.lastEventLabel}`
              : 'Уведомлений о заказах ещё не было'
          }}
        </p>
      </div>

      <div v-if="targets.length">
        <Button variant="ghost" size="sm" :disabled="isRotating" @click="rotateOpen = true">
          <RefreshCw />
          Сменить адрес
        </Button>
      </div>
    </template>
  </div>

  <ConfirmDialog
    v-model:open="rotateOpen"
    title="Сменить адрес уведомлений?"
    description="Старый адрес перестанет работать сразу. Уведомления Ozon, подключённые отсюда, перенастроим сами. В кабинете Маркета адрес нужно заменить вручную — до этого Маркет будет копить уведомления."
    confirm-label="Сменить"
    :busy="isRotating"
    @confirm="rotate"
  />
</template>
