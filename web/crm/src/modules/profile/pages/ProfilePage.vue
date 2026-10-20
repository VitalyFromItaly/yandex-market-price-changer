<script setup lang="ts">
/**
 * «Профиль»: те же поля, что «📊 Мой профиль» в боте (данные — из той же
 * функции на сервере), и вкладка «Безопасность» со сменой пароля.
 */
import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

import ProfileCard from '../components/ProfileCard.vue';
import { useProfileTabs } from '../composables/useProfileTabs.profile';
import { PROFILE_TAB } from '../profile.domain';
import { useProfileStore } from '../store/store.profile';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
// Исключение из «не импортировать внутренности чужого модуля»: форма смены
// пароля уже переиспользуется (вход с обязательной сменой), а копия в профиле
// разошлась бы с ней при первой правке правил пароля.
import PasswordChangeForm from '@/modules/auth/components/PasswordChangeForm.vue';

const store = useProfileStore();
const { profile, error, isRefreshing, savedAt } = storeToRefs(store);
const { open, active, activeKey } = useProfileTabs();

// Профиль грузится, когда открыта его вкладка: на «Безопасности» он не нужен.
watch(
  () => active.value?.key,
  (key) => {
    // Запрос при каждом открытии вкладки; прошлый профиль тем временем на экране.
    if (key === PROFILE_TAB.INFO) void store.load();
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader
    title="Профиль"
    :description="
      active?.key === PROFILE_TAB.SECURITY
        ? 'После смены пароля другие открытые вкладки и устройства выйдут из CRM'
        : 'Ваш аккаунт и магазин — то же, что «📊 Мой профиль» в боте'
    "
  >
    <template #filters>
      <Tabs v-model="activeKey">
        <TabsList>
          <TabsTrigger v-for="tab in open" :key="tab.key" :value="tab.key">
            {{ tab.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </template>
  </PageHeader>

  <Card v-if="active?.key === PROFILE_TAB.SECURITY" class="max-w-md">
    <CardHeader>
      <CardTitle>Смена пароля</CardTitle>
    </CardHeader>
    <CardContent>
      <PasswordChangeForm />
    </CardContent>
  </Card>

  <div v-else-if="error && !profile" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.load()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!profile" class="flex max-w-2xl flex-col gap-6" aria-busy="true">
    <Skeleton class="h-72 w-full" />
    <Skeleton class="h-32 w-full" />
  </div>

  <div v-else class="flex max-w-2xl flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.load()"
    />
    <ProfileCard :profile="profile" />
  </div>
</template>
