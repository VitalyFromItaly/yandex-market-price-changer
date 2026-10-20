<script setup lang="ts">
/**
 * «Уведомления» (TASK-152): лента того, что нашли правила, и их настройка.
 * Проверку делает очередь раз в день; кнопка «Проверить сейчас» ставит её
 * вне расписания. Данные вкладки грузятся при её открытии.
 */
import { BellOff, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import NotificationsTable from '../components/NotificationsTable.vue';
import RulesCard from '../components/RulesCard.vue';
import TelegramCard from '../components/TelegramCard.vue';
import { useFeedActions } from '../composables/useFeedActions.notifications';
import { useNotificationsTabs } from '../composables/useNotificationsTabs.notifications';
import { useNotificationsStore } from '../store/store.notifications';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const store = useNotificationsStore();
const { feed, error, unreadOnly, settings, settingsError } = storeToRefs(store);
const { tabs, activeKey } = useNotificationsTabs();
const { busy, checkNow, readAll, readOne } = useFeedActions();

const unreadFilter = computed<boolean>({
  get: () => unreadOnly.value,
  set: (value) => void store.setUnreadOnly(value),
});

watch(
  activeKey,
  (key) => {
    if (key === 'settings' && settings.value === null) void store.loadSettings();
    if (key === 'feed' && feed.value === null) void store.load();
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader
    title="Уведомления"
    description="Продажи, расходы, остатки, возвраты, удержания и налог — что требует внимания"
  >
    <template v-if="activeKey === 'feed'" #actions>
      <Button variant="outline" :disabled="busy || !feed?.unread" @click="readAll">
        Прочитать все
      </Button>
      <Button :disabled="busy" @click="checkNow">Проверить сейчас</Button>
    </template>
    <template #filters>
      <Tabs v-model="activeKey">
        <TabsList>
          <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key">
            {{ tab.label }}
            <template v-if="tab.key === 'feed' && feed?.unread"> · {{ feed.unread }}</template>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Checkbox v-if="activeKey === 'feed'" v-model="unreadFilter" label="Только непрочитанные" />
    </template>
  </PageHeader>

  <template v-if="activeKey === 'feed'">
    <div v-if="error && !feed" class="flex flex-col items-start gap-3">
      <Alert>{{ error }}</Alert>
      <Button variant="outline" @click="store.load()">
        <RotateCw />
        Повторить
      </Button>
    </div>
    <div v-else-if="!feed" class="flex flex-col gap-3" aria-busy="true">
      <Skeleton v-for="i in 4" :key="i" class="h-16 w-full" />
    </div>
    <EmptyState
      v-else-if="!feed.items.length"
      :icon="BellOff"
      :title="unreadOnly ? 'Непрочитанных нет' : 'Уведомлений пока нет'"
      description="Правила проверяются раз в день. Когда что-то потребует внимания — оно появится здесь."
    />
    <NotificationsTable v-else :items="feed.items" :busy="busy" @read="readOne" />
  </template>

  <template v-else>
    <div v-if="settingsError && !settings" class="flex flex-col items-start gap-3">
      <Alert>{{ settingsError }}</Alert>
      <Button variant="outline" @click="store.loadSettings()">
        <RotateCw />
        Повторить
      </Button>
    </div>
    <div v-else-if="!settings" class="flex max-w-3xl flex-col gap-6" aria-busy="true">
      <Skeleton class="h-28 w-full" />
      <Skeleton class="h-96 w-full" />
    </div>
    <div v-else class="flex max-w-3xl flex-col gap-6">
      <TelegramCard v-if="settings.telegramAvailable" />
      <RulesCard :settings="settings" />
    </div>
  </template>
</template>
