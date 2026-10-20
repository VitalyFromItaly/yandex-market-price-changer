<script setup lang="ts">
/**
 * «Настройки»: ставки, скидки по брендам и продвижение, по которым считается
 * «Прибыль». Пишет в тот же документ магазина через тот же сервис, что бот, —
 * правка здесь сразу видна в «⚙️ Настройки» бота и наоборот.
 */
import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';

import ProfitSettingsForm from '../components/ProfitSettingsForm.vue';
import PromotionCard from '../components/PromotionCard.vue';
import { useSettingsStore } from '../store/store.settings';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

const store = useSettingsStore();
const { settings, error } = storeToRefs(store);

onMounted(() => {
  void store.load();
});
</script>

<template>
  <PageHeader title="Настройки" description="Ставки, скидки и продвижение для расчёта прибыли" />

  <div v-if="error && !settings" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.load()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!settings" class="flex max-w-3xl flex-col gap-6" aria-busy="true">
    <Skeleton class="h-40 w-full" />
    <Skeleton class="h-64 w-full" />
  </div>

  <div v-else class="flex max-w-3xl flex-col gap-6">
    <ProfitSettingsForm :settings="settings" />
    <PromotionCard v-if="settings.promotion" :promotion="settings.promotion" />
  </div>
</template>
