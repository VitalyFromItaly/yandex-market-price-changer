<script setup lang="ts">
/**
 * «Подключения» (TASK-161): API-ключи всех площадок одним экраном — статус
 * связи, маска ключа, проверка и замена. Яндекс Маркет открыт всем; Ozon и
 * Wildberries — по своим фичам, закрытая площадка показана «скоро».
 */
import type { ConnectionCard as TConnectionCard } from '../marketplaces.domain';
import type { MarketplaceKey } from '@/navigation';

import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';

import ConnectionCard from '../components/ConnectionCard.vue';
import OzonKeyForm from '../components/OzonKeyForm.vue';
import WbTokenForm from '../components/WbTokenForm.vue';
import YmTokenForm from '../components/YmTokenForm.vue';
import { useMarketplacesStore } from '../store/store.marketplaces';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';

const store = useMarketplacesStore();
const { cards, cardsLoading, hasCards, cardsError, checking } = storeToRefs(store);

onMounted(() => void store.loadCards());

async function check(card: TConnectionCard): Promise<void> {
  try {
    const result = await store.checkConnection(card.key);
    if (result.status === 'ok') toast.success('Связь есть', result.message);
    else if (result.status === 'unavailable') toast.info('Связь не проверена', result.message);
    else toast.error('Ключ не работает', result.message);
  } catch (e) {
    toast.error('Не удалось проверить', e instanceof Error ? e.message : undefined);
  }
}

/** Форма ключа — своя у каждой площадки: у ЯМ и WB токен, у Ozon пара Client-Id + Api-Key. */
const FORMS: Record<MarketplaceKey, typeof YmTokenForm | typeof OzonKeyForm | typeof WbTokenForm> =
  {
    ym: YmTokenForm,
    ozon: OzonKeyForm,
    wb: WbTokenForm,
  };
</script>

<template>
  <PageHeader
    title="Подключения"
    description="API-ключи площадок. Новый ключ проверяется до сохранения — если не подойдёт, останется прежний"
  />

  <div class="flex max-w-3xl flex-col gap-4">
    <div v-if="cardsError && !hasCards" class="flex flex-col items-start gap-3">
      <Alert>{{ cardsError }}</Alert>
      <Button variant="outline" @click="store.loadCards()">
        <RotateCw />
        Повторить
      </Button>
    </div>

    <template v-else-if="!hasCards && cardsLoading">
      <Skeleton v-for="n in 3" :key="n" class="h-32 w-full" />
    </template>

    <ConnectionCard
      v-for="card in cards"
      :key="card.key"
      :card="card"
      :checking="checking === card.key"
      @check="check(card)"
    >
      <template #form="{ close }">
        <component :is="FORMS[card.key]" @done="close" @cancel="close" />
      </template>
    </ConnectionCard>
  </div>
</template>
