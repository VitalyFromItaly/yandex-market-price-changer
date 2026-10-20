<script setup lang="ts">
/**
 * Ответ аналитика: текст, плашка непроверенных чисел, ссылки на операции и
 * отчёты, пробелы данных. Пробелы печатаются отдельно от текста — модель могла
 * о них промолчать, а продавец должен знать, чего в ответе нет.
 */
import type { AnswerModel, AnswerRating } from '../ai-analyst.domain';
import type { OpenedArticle } from '@/shared/finance-operations';

import { AlertTriangle, ThumbsDown, ThumbsUp } from 'lucide-vue-next';

import SourceLinkRow from './SourceLinkRow.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** `rating` не передан — оценки нет (ход без id): кнопок 👍/👎 не показываем. */
defineProps<{ answer: AnswerModel; rating?: AnswerRating | null }>();
const emit = defineEmits<{
  operations: [opened: OpenedArticle];
  download: [documentId: string];
  rate: [rating: AnswerRating];
}>();
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="whitespace-pre-line text-sm leading-relaxed">{{ answer.text }}</p>

    <Alert v-if="answer.unverified" variant="warn">
      <AlertTriangle />
      <span>{{ answer.unverified }}. ИИ мог посчитать их сам — сверьте по ссылкам ниже.</span>
    </Alert>

    <div v-if="answer.gaps.length" class="flex flex-col gap-1 text-sm text-muted-foreground">
      <span class="font-medium text-foreground">Данных недостаточно</span>
      <span v-for="gap in answer.gaps" :key="gap">— {{ gap }}</span>
    </div>

    <div v-if="answer.sources.length" class="flex flex-col gap-1.5">
      <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Источники
      </span>
      <SourceLinkRow
        v-for="source in answer.sources"
        :key="source.key"
        :source="source"
        @operations="emit('operations', $event)"
        @download="emit('download', $event)"
      />
    </div>

    <div v-if="rating !== undefined" class="flex items-center gap-1 text-xs text-muted-foreground">
      <span class="mr-1">Ответ полезен?</span>
      <Button
        :variant="rating === 'up' ? 'soft' : 'ghost'"
        size="icon"
        class="size-7"
        aria-label="Полезный ответ"
        :aria-pressed="rating === 'up'"
        @click="emit('rate', 'up')"
      >
        <ThumbsUp />
      </Button>
      <Button
        :variant="rating === 'down' ? 'soft' : 'ghost'"
        size="icon"
        class="size-7"
        aria-label="Бесполезный ответ"
        :aria-pressed="rating === 'down'"
        @click="emit('rate', 'down')"
      >
        <ThumbsDown />
      </Button>
    </div>
  </div>
</template>
