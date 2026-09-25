<script setup lang="ts">
/**
 * «Отзывы»: отзывы о товарах, ждущие реакции, ответ и «Пропустить». Список и
 * записи — тем же сервисом, что у бота. Ответ публичный: наружу он уходит только
 * из шага превью, «Пропустить» — только через подтверждение.
 */
import { MessagesSquare, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import FeedbackReplyDialog from '../components/FeedbackReplyDialog.vue';
import FeedbackTable from '../components/FeedbackTable.vue';
import { useFeedbackReply } from '../composables/useFeedbackReply.feedback';
import { useFeedbackSkip } from '../composables/useFeedbackSkip.feedback';
import { useFeedbackStore } from '../store/store.feedback';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreKey } from '@/shared/composables';

const store = useFeedbackStore();
const { view, isLoading, isRefreshing, savedAt, loadError, isWriting } = storeToRefs(store);
const storeKey = useStoreKey();
const reply = useFeedbackReply(storeKey);
const skip = useFeedbackSkip(storeKey);
const { row: replyRow, step, text, error: replyError, maxLength } = reply;

watch(
  storeKey,
  (key) => {
    if (key !== '') void store.load(key);
  },
  { immediate: true },
);

const rows = computed(() => view.value?.rows ?? []);
const busy = computed(() => isLoading.value || isWriting.value);
</script>

<template>
  <PageHeader title="Отзывы" description="Отзывы о товарах, которые ждут вашего ответа">
    <template v-if="view" #actions>
      <Button variant="outline" :disabled="busy" @click="store.load(storeKey)">
        <RotateCw />
        Обновить
      </Button>
    </template>
  </PageHeader>

  <div v-if="loadError && !view" class="flex flex-col items-start gap-3">
    <Alert>{{ loadError }}</Alert>
    <Button variant="outline" @click="store.load(storeKey)">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <Skeleton v-else-if="!view" class="h-72 w-full" aria-busy="true" />

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="loadError"
      @retry="store.load(storeKey)"
    />

    <EmptyState
      v-if="rows.length === 0"
      :icon="MessagesSquare"
      title="Отзывов без ответа нет"
      description="Всё прочитано — новые отзывы появятся здесь."
    />

    <template v-else>
      <Alert variant="warn" class="whitespace-pre-line">
        {{ [view.note, view.productNote, view.more].filter(Boolean).join('\n') }}
      </Alert>
      <FeedbackTable
        :rows="rows"
        :disabled="busy"
        :has-draft="reply.hasDraft"
        :aria-busy="busy"
        @reply="reply.open"
        @skip="skip.ask"
      />
    </template>
  </div>

  <FeedbackReplyDialog
    v-model:open="reply.dialogOpen.value"
    v-model:text="text"
    :row="replyRow"
    :step="step"
    :error="replyError"
    :max-length="maxLength"
    :public-note="view?.publicNote ?? ''"
    :busy="isWriting"
    @preview="reply.preview"
    @back="reply.back"
    @publish="reply.publish"
  />

  <ConfirmDialog
    v-model:open="skip.dialogOpen.value"
    title="Пропустить отзыв без ответа?"
    description="Отзыв уйдёт из списка и перестанет ждать ответа. Ответить на него можно будет только в кабинете Маркета."
    confirm-label="Пропустить"
    :busy="isWriting"
    @confirm="skip.confirm()"
  />
</template>
