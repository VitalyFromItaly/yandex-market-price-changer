<script setup lang="ts">
/**
 * Ответ на отзыв в два шага: текст → превью → «Опубликовать». Ответ публичный,
 * поэтому кнопки публикации на шаге правки нет вовсе. Закрытие диалога
 * черновик не стирает — им владеет `useFeedbackReply`.
 */
import type { ReplyStep } from '../composables/useFeedbackReply.feedback';
import type { FeedbackRow } from '../feedback.domain';

import { computed } from 'vue';

import { feedbackQuote } from '../mappers/mapFeedback.feedback';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';

const props = defineProps<{
  row: FeedbackRow | null;
  step: ReplyStep;
  error: string | null;
  maxLength: number;
  publicNote: string;
  busy: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const text = defineModel<string>('text', { default: '' });
const emit = defineEmits<{ preview: []; back: []; publish: [] }>();

const counter = computed(() => `${text.value.length} / ${props.maxLength}`);
const over = computed(() => text.value.length > props.maxLength);
const quote = computed(() => (props.row === null ? '' : feedbackQuote(props.row)));
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>
          {{ step === 'edit' ? 'Ответ на отзыв' : 'Опубликовать ответ?' }}
        </DialogTitle>
        <DialogDescription>{{ publicNote }}</DialogDescription>
      </DialogHeader>

      <template v-if="step === 'edit'">
        <blockquote
          v-if="row && row.parts.length > 0"
          class="max-h-40 overflow-y-auto whitespace-pre-line rounded-md bg-muted p-3 text-sm"
          v-text="quote"
        />
        <FormField id="feedback-reply" label="Ваш ответ" :error="error">
          <template #default="{ attrs }">
            <Textarea v-bind="attrs" v-model="text" :disabled="busy" rows="6" />
          </template>
        </FormField>
        <p
          class="tnum -mt-2 text-right text-xs"
          :class="over ? 'text-danger' : 'text-muted-foreground'"
        >
          {{ counter }}
        </p>
      </template>

      <template v-else>
        <Alert v-if="error">{{ error }}</Alert>
        <p class="text-sm text-muted-foreground">Вот что увидят покупатели:</p>
        <blockquote
          class="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-sm"
          v-text="text"
        />
      </template>

      <DialogFooter>
        <template v-if="step === 'edit'">
          <Button variant="outline" :disabled="busy" @click="open = false">Отмена</Button>
          <Button :disabled="busy" @click="emit('preview')">Предпросмотр</Button>
        </template>
        <template v-else>
          <Button variant="outline" :disabled="busy" @click="emit('back')">Изменить</Button>
          <Button :disabled="busy" @click="emit('publish')">
            {{ busy ? 'Публикую…' : 'Опубликовать' }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
