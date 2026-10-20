<script setup lang="ts">
/**
 * Вкладка «Чат» (TASK-148): вопросы о финансах, ответы — пересказ данных
 * финжурнала со ссылками на операции. История — только во вкладке браузера.
 */
import type { OpenedArticle } from '@/shared/finance-operations';

import { SendHorizontal, Sparkles } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';

import { MAX_QUESTION_CHARS, SUGGESTED_QUESTIONS } from '../ai-analyst.domain';
import { useAiAnalystStore } from '../store/store.ai-analyst';

import AnswerBubble from './AnswerBubble.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const emit = defineEmits<{ operations: [opened: OpenedArticle]; download: [documentId: string] }>();

const store = useAiAnalystStore();
const { messages, draft, pending, error } = storeToRefs(store);

function onKeydown(event: KeyboardEvent): void {
  // Enter — отправить, Shift+Enter — перенос строки.
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void store.send();
  }
}
</script>

<template>
  <p class="text-sm text-muted-foreground">
    ИИ пересказывает числа журнала и не считает сам; число, которого нет в данных, помечается.
    История живёт только в этой вкладке — после перезагрузки её не будет.
  </p>

  <Card class="flex flex-col gap-4 p-4">
    <EmptyState
      v-if="messages.length === 0 && !pending"
      :icon="Sparkles"
      title="Спросите о своих финансах"
      description="Например:"
    >
      <div class="flex flex-wrap justify-center gap-2">
        <Button
          v-for="question in SUGGESTED_QUESTIONS"
          :key="question"
          variant="chip"
          size="sm"
          @click="store.send(question)"
        >
          {{ question }}
        </Button>
      </div>
    </EmptyState>

    <div v-else class="flex flex-col gap-4" aria-live="polite">
      <div
        v-for="message in messages"
        :key="message.id"
        :class="message.role === 'user' ? 'flex justify-end' : 'flex justify-start'"
      >
        <div
          v-if="message.role === 'user'"
          class="max-w-[80%] whitespace-pre-line rounded-lg bg-primary-subtle px-3 py-2 text-sm"
        >
          {{ message.content }}
        </div>
        <div v-else-if="message.answer" class="w-full max-w-3xl rounded-lg border px-4 py-3">
          <AnswerBubble
            :answer="message.answer"
            :rating="message.turnId ? (message.rating ?? null) : undefined"
            @rate="store.rate(message.id, $event)"
            @operations="emit('operations', $event)"
            @download="emit('download', $event)"
          />
        </div>
      </div>
      <div v-if="pending" class="flex flex-col gap-2" aria-busy="true">
        <span class="text-sm text-muted-foreground">Смотрю журнал и считаю ответ…</span>
        <Skeleton class="h-16 w-full max-w-3xl" />
      </div>
    </div>

    <Alert v-if="error">{{ error }}</Alert>

    <form class="flex items-end gap-2" @submit.prevent="store.send()">
      <Textarea
        v-model="draft"
        class="min-h-12 flex-1 resize-none"
        rows="2"
        :maxlength="MAX_QUESTION_CHARS"
        :disabled="pending"
        placeholder="Где я заработал больше в прошлом месяце?"
        aria-label="Вопрос ИИ-аналитику"
        @keydown="onKeydown"
      />
      <Button type="submit" :disabled="pending || !draft.trim()" aria-label="Спросить">
        <SendHorizontal />
        Спросить
      </Button>
    </form>
  </Card>
</template>
