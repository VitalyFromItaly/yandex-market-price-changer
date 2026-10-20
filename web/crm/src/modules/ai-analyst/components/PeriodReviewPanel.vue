<script setup lang="ts">
/**
 * Вкладка «Разбор периода» (TASK-150): месяц → «Разобрать период» → текст
 * модели по фактам сервера и карточки рекомендаций. Рекомендации рисуются из
 * кандидатов сервера, а не из текста: у каждой есть ссылка на данные, и
 * придуманной быть не может (решение `ai_period_review_server_facts`).
 */
import type { OpenedArticle } from '@/shared/finance-operations';

import { CalendarDays, Check, ChevronDown, FileSearch, Lightbulb } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import { useAiAnalystStore } from '../store/store.ai-analyst';

import AnswerBubble from './AnswerBubble.vue';
import SourceLinkRow from './SourceLinkRow.vue';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { monthLabel, recentMonths } from '@/shared/period';
import { moscowToday } from '@/shared/utils';

const emit = defineEmits<{ operations: [opened: OpenedArticle]; download: [documentId: string] }>();

const store = useAiAnalystStore();
const { reviewMonth, review, reviewPending, reviewError, reviewRating } = storeToRefs(store);

/** Те же месяцы, что принимает сервер: текущий и двенадцать прошлых. */
const months = computed(() => recentMonths(moscowToday()));
</script>

<template>
  <p class="text-sm text-muted-foreground">
    Сервер считает итоги, изменения статей, подозрительные списания, убыточные товары и выплаты
    месяца к прошлому, а ИИ только объясняет их. Рекомендации — из юнит-экономики, у каждой — ссылка
    на данные.
  </p>

  <div class="flex flex-wrap items-center gap-2">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="outline" :disabled="reviewPending" aria-label="Выбрать месяц">
          <CalendarDays />
          {{ monthLabel(reviewMonth) }}
          <ChevronDown class="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-56">
        <DropdownMenuItem
          v-for="month in months"
          :key="month"
          @select="store.selectReviewMonth(month)"
        >
          <Check class="shrink-0" :class="month === reviewMonth ? '' : 'invisible'" />
          {{ monthLabel(month) }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Button :disabled="reviewPending" @click="store.runReview()">
      <FileSearch />
      Разобрать период
    </Button>
  </div>

  <Alert v-if="reviewError">{{ reviewError }}</Alert>

  <div v-if="reviewPending" class="flex flex-col gap-2" aria-busy="true">
    <span class="text-sm text-muted-foreground">Собираю факты месяца и пишу разбор…</span>
    <Skeleton class="h-32 w-full" />
  </div>

  <template v-else-if="review">
    <Card>
      <CardHeader>
        <CardTitle>{{ review.title }}</CardTitle>
      </CardHeader>
      <CardContent>
        <AnswerBubble
          v-if="review.answer"
          :answer="review.answer"
          :rating="reviewRating"
          @rate="store.rateReview($event)"
          @operations="emit('operations', $event)"
          @download="emit('download', $event)"
        />
        <div v-else class="flex flex-col gap-1 text-sm text-muted-foreground">
          <span class="font-medium text-foreground">Данных недостаточно</span>
          <span v-for="gap in review.gaps" :key="gap">— {{ gap }}</span>
        </div>
      </CardContent>
    </Card>

    <Card v-if="review.recommendations.length">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Lightbulb class="size-4" />
          Рекомендации
        </CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div
          v-for="card in review.recommendations"
          :key="card.id"
          class="flex flex-col gap-1.5 border-b pb-4 last:border-b-0 last:pb-0"
        >
          <div class="flex flex-wrap items-center gap-2">
            <Badge>{{ card.id }}</Badge>
            <span class="font-medium">{{ card.title }}</span>
            <span v-if="card.schemes" class="text-sm text-muted-foreground">{{
              card.schemes
            }}</span>
          </div>
          <p class="text-sm">{{ card.text }}</p>
          <SourceLinkRow
            :source="card.source"
            hide-label
            @operations="emit('operations', $event)"
            @download="emit('download', $event)"
          />
        </div>
      </CardContent>
    </Card>
  </template>

  <EmptyState
    v-else-if="!reviewError"
    :icon="FileSearch"
    title="Выберите месяц и нажмите «Разобрать период»"
    description="Разбор — один запрос к ИИ; цифры совпадают с «Финансами» за тот же месяц."
  />
</template>
