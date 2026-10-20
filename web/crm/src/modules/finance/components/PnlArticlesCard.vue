<script setup lang="ts">
/**
 * Статьи журнала по разделам P&L. Строка статьи — кнопка: раскрытие до
 * операций и оригинала отчёта. Справочный раздел (оплачено баллами) в
 * прибыль не входит — подписан.
 */
import type { PnlArticleRow, PnlModel } from '../finance.domain';

import { ChevronRight } from 'lucide-vue-next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{ sections: PnlModel['sections'] }>();
const emit = defineEmits<{ open: [article: PnlArticleRow] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Статьи</CardTitle>
      <CardDescription>Нажмите на статью — откроются её операции и оригинал отчёта</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-5 text-sm">
      <p v-if="sections.length === 0" class="text-muted-foreground">
        За этот месяц в журнале нет операций — или он ещё не загружен.
      </p>
      <section v-for="section in sections" :key="section.key" class="flex flex-col gap-1">
        <div class="flex justify-between gap-4 font-medium">
          <h3>
            {{ section.title }}
            <span v-if="section.reference" class="text-xs font-normal text-muted-foreground">
              — в прибыль не входит
            </span>
          </h3>
          <span class="tabular-nums">{{ section.amount }}</span>
        </div>
        <button
          v-for="article in section.articles"
          :key="article.article"
          type="button"
          class="flex items-center gap-3 rounded-md py-1.5 pl-4 pr-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="emit('open', article)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ article.title }}</span>
            <span class="block text-xs text-muted-foreground">{{ article.countLabel }}</span>
          </span>
          <span
            class="whitespace-nowrap tabular-nums"
            :class="article.negative ? 'text-muted-foreground' : ''"
          >
            {{ article.amount }}
          </span>
          <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
        </button>
      </section>
    </CardContent>
  </Card>
</template>
