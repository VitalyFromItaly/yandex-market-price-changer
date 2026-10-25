<script setup lang="ts">
/**
 * Журнал за период экрана: не загружен — баннер с причиной и «Загрузить из
 * Маркета»; загружен — тихая строка «Журнал обновлён …» и «Обновить». Кнопки —
 * только при фиче `finance_pull`; без неё баннер говорит, когда журнал придёт сам.
 */
import type { FinanceJournal } from './useFinanceJournal';

import { Download, RefreshCw } from 'lucide-vue-next';
import { computed } from 'vue';

import {
  JOURNAL_SOURCE_NAME,
  checkedAtText,
  failedText,
  missingTitle,
} from './financeJournal.domain';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const props = defineProps<{
  journal: FinanceJournal;
  /** Площадка в заголовке — на экранах с несколькими площадками. */
  label?: string;
  /** Только баннер незагруженного журнала, без строки «Журнал обновлён». */
  onlyMissing?: boolean;
}>();

const { marketplace, canPull, coverage, missing, refreshable, pulling, notice, error, pull } =
  props.journal;

const sourceName = computed(() => JOURNAL_SOURCE_NAME[marketplace.value]);

const failed = computed(() => coverage.value?.failed ?? []);
const checkedAt = computed(() => coverage.value?.checkedAt ?? null);

const hint = computed(() => {
  if (pulling.value) {
    return `Заказали отчёт у ${sourceName.value} — обычно это 1–3 минуты, экран обновится сам.`;
  }
  if (canPull.value) return 'Журнал загружается каждую ночь — можно не ждать и загрузить сейчас.';
  return 'Журнал загружается каждую ночь — данные появятся утром.';
});
</script>

<template>
  <div v-if="coverage" class="flex flex-col gap-2">
    <Alert v-if="missing.length" variant="warn">
      <div class="flex flex-col gap-2">
        <p class="font-medium">
          <template v-if="label">{{ label }}: </template>{{ missingTitle(missing) }}
        </p>
        <p>{{ hint }}</p>
        <p v-if="failed.length && !pulling">{{ failedText(failed) }}</p>
        <div v-if="canPull">
          <Button size="sm" :disabled="pulling" @click="pull()">
            <RefreshCw v-if="pulling" class="animate-spin" aria-hidden="true" />
            <Download v-else aria-hidden="true" />
            {{ pulling ? 'Загружаю…' : `Загрузить из ${sourceName}` }}
          </Button>
        </div>
      </div>
    </Alert>

    <p
      v-else-if="checkedAt && !onlyMissing"
      class="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
    >
      <span>{{ checkedAtText(checkedAt) }}</span>
      <template v-if="canPull && refreshable.length">
        <span aria-hidden="true">·</span>
        <Button
          variant="link"
          size="sm"
          class="h-auto px-0 text-xs"
          :disabled="pulling"
          @click="pull()"
        >
          {{ pulling ? 'Обновляю…' : 'Обновить' }}
        </Button>
      </template>
      <span v-if="failed.length && !pulling">· {{ failedText(failed) }}</span>
    </p>

    <p v-if="notice" class="text-xs text-muted-foreground">{{ notice }}</p>
    <Alert v-if="error">{{ error }}</Alert>
  </div>
</template>
