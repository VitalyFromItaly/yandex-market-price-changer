<script setup lang="ts">
/**
 * На экране прошлые данные, свежие собираются. Тонкая бегущая полоса и
 * подпись «Обновляю… · данные на 14:32» — отчёт это снимок, и продавец должен
 * видеть, на какой момент цифры (правило «снимок печатает момент съёмки»).
 *
 * Сбой обновления при показанных данных — не пустой экран, а предупреждение
 * над ними с «Повторить»: цифры остаются, но видно, что они не свежие.
 *
 * Место под строку занято всегда (`min-h`), чтобы контент не прыгал, когда
 * обновление закончилось. Скелетон — только когда данных нет вовсе.
 */
import { RotateCw } from 'lucide-vue-next';
import { computed } from 'vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatSavedAt } from '@/shared/utils';

const props = defineProps<{
  refreshing: boolean;
  savedAt: string | null;
  /** Сбой обновления — текст; показывается, только пока на экране прошлые данные. */
  error?: string | null;
  /** Компактно — для плиток главной. */
  compact?: boolean;
  class?: string;
}>();
const emit = defineEmits<{ retry: [] }>();

const at = computed(() => (props.savedAt === null ? null : formatSavedAt(props.savedAt)));
</script>

<template>
  <Alert v-if="error" variant="warn" :class="props.class">
    <span>Не удалось обновить: {{ error }}</span>
    <span v-if="at"> Показаны данные на {{ at }}.</span>
    <Button variant="ghost" size="sm" class="ml-1 h-6 px-2 align-middle" @click="emit('retry')">
      <RotateCw aria-hidden="true" />
      Повторить
    </Button>
  </Alert>
  <div
    v-else
    :class="cn('flex flex-col gap-1', compact ? 'min-h-4' : 'min-h-6', props.class)"
    :aria-busy="refreshing"
  >
    <template v-if="refreshing">
      <div
        class="relative h-0.5 w-full overflow-hidden rounded-full bg-primary/20"
        aria-hidden="true"
      >
        <div class="refresh-sweep absolute inset-y-0 w-1/3 rounded-full bg-primary" />
      </div>
      <p class="text-xs text-muted-foreground" role="status">
        Обновляю…<template v-if="at"> · данные на {{ at }}</template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.refresh-sweep {
  animation: refresh-sweep 1.2s ease-in-out infinite;
}

@keyframes refresh-sweep {
  from {
    left: -33%;
  }
  to {
    left: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .refresh-sweep {
    animation: none;
    left: 0;
    width: 100%;
    opacity: 0.6;
  }
}
</style>
