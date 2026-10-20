<script setup lang="ts">
/**
 * «Помощь» — справка `/help` бота слово в слово: сервер отдаёт ту же модель,
 * из которой бот рендерит свой текст. Кнопки вида «🚚 Уехало клиенту» —
 * это кнопки бота, поэтому страница так и называется.
 */
import { ExternalLink, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';

import HelpBlockView from '../components/HelpBlockView.vue';
import { useHelpStore } from '../store/store.help';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';

const store = useHelpStore();
const { help, error, isRefreshing, savedAt } = storeToRefs(store);

onMounted(() => {
  void store.load();
});
</script>

<template>
  <PageHeader title="Помощь" description="Справка по боту — то же, что команда /help" />

  <div v-if="error && !help" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.load()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!help" class="flex max-w-3xl flex-col gap-6" aria-busy="true">
    <Skeleton class="h-24 w-full" />
    <Skeleton class="h-48 w-full" />
    <Skeleton class="h-32 w-full" />
  </div>

  <div v-else class="flex max-w-3xl flex-col gap-6">
    <RefreshIndicator
      class="-mb-3"
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.load()"
    />
    <Card>
      <CardHeader>
        <CardTitle>Поддержка</CardTitle>
        <CardDescription
          >Если что-то не работает или непонятно — напишите в Telegram.</CardDescription
        >
      </CardHeader>
      <CardContent>
        <Button
          v-if="help.supportUrl"
          as="a"
          variant="outline"
          :href="help.supportUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink />
          {{ help.supportContact }}
        </Button>
        <span v-else class="text-sm">{{ help.supportContact }}</span>
      </CardContent>
    </Card>

    <Card v-for="section in help.sections" :key="section.title">
      <CardHeader>
        <CardTitle>{{ section.title }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <HelpBlockView v-for="(block, index) in section.blocks" :key="index" :block="block" />
      </CardContent>
    </Card>
  </div>
</template>
