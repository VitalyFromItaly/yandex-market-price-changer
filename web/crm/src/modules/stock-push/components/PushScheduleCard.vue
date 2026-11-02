<script setup lang="ts">
/**
 * «Синхронизация остатков между площадками»: зачем она, как часто и чем
 * закончилась последняя. На «Прайсе» — без выбора, со ссылкой в «Настройки»;
 * в «Настройках» — с выбором частоты. Тексты и варианты — с сервера.
 */
import type { PushInterval } from '../stock-push.domain';

import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';

import { useStockPushStore } from '../store/store.stock-push';

import PushEventsBlock from './PushEventsBlock.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OptionGroup } from '@/components/ui/option-group';
import { Skeleton } from '@/components/ui/skeleton';
import { sectionPath } from '@/navigation.sections';

const props = defineProps<{ editable?: boolean }>();

const store = useStockPushStore();
const { schedule, error, saveError, isSaving } = storeToRefs(store);

onMounted(() => {
  if (!schedule.value) void store.load();
});

function choose(interval: PushInterval): void {
  void store.saveInterval(interval);
}

const settingsPath = sectionPath('ym', 'settings');
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Синхронизация остатков между площадками</CardTitle>
      <CardDescription v-if="schedule">
        {{
          schedule.interval === 'off'
            ? 'Синхронизация выключена'
            : `Синхронизация ${schedule.intervalLabel}`
        }}
        <template v-if="schedule.nextRunLabel"> · следующая в {{ schedule.nextRunLabel }}</template>
      </CardDescription>
    </CardHeader>

    <CardContent class="flex flex-col gap-4">
      <div v-if="error && !schedule" class="flex flex-col items-start gap-3">
        <Alert>{{ error }}</Alert>
        <Button variant="outline" size="sm" @click="store.load()">
          <RotateCw />
          Повторить
        </Button>
      </div>

      <Skeleton v-else-if="!schedule" class="h-24 w-full" aria-busy="true" />

      <template v-else>
        <div class="flex max-w-prose flex-col gap-2 text-sm text-muted-foreground">
          <p v-for="(paragraph, index) in schedule.about" :key="index">{{ paragraph }}</p>
        </div>

        <p v-if="schedule.lastRun" class="text-sm">
          Последняя — {{ schedule.lastRun.atLabel }}:
          <span :class="{ 'text-danger': !schedule.lastRun.ok }">{{
            schedule.lastRun.summary
          }}</span>
        </p>

        <div v-if="props.editable" class="flex flex-col gap-2">
          <span class="text-sm font-medium">Как часто синхронизировать</span>
          <OptionGroup
            :model-value="schedule.interval"
            :options="schedule.options"
            label="Как часто синхронизировать"
            :disabled="isSaving"
            @update:model-value="choose"
          />
          <p v-if="saveError" class="text-sm text-danger" role="alert">{{ saveError }}</p>
        </div>

        <PushEventsBlock v-if="props.editable && schedule.events" :events="schedule.events" />

        <RouterLink v-else :to="settingsPath" class="text-sm text-link underline">
          Изменить частоту
        </RouterLink>
      </template>
    </CardContent>
  </Card>
</template>
