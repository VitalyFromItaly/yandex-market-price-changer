<script setup lang="ts">
/**
 * «ИИ-аналитик» (TASK-148, TASK-150): вкладки «Чат» и «Разбор периода», каждая
 * под своей фичей. ИИ не считает (решение `ai_explains_not_computes`): сервер
 * сверяет каждое число с данными журнала и помечает то, чего там нет.
 */
import { storeToRefs } from 'pinia';

import ChatPanel from '../components/ChatPanel.vue';
import PeriodReviewPanel from '../components/PeriodReviewPanel.vue';
import { useAiAnalystTabs } from '../composables/useAiAnalystTabs.ai-analyst';
import { useAiAnalystStore } from '../store/store.ai-analyst';

import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArticleOperationsDialog } from '@/shared/finance-operations';

const store = useAiAnalystStore();
const {
  article,
  operations,
  operationsPage,
  operationsPages,
  operationsLoading,
  operationsError,
  downloadError,
} = storeToRefs(store);

const { open: tabs, activeKey } = useAiAnalystTabs();
</script>

<template>
  <PageHeader
    title="ИИ-аналитик"
    description="Вопросы и разбор месяца по финансовому журналу — со ссылками на операции"
  />

  <Tabs v-if="tabs.length > 1" v-model="activeKey" class="mb-2">
    <TabsList>
      <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key">{{ tab.label }}</TabsTrigger>
    </TabsList>
  </Tabs>

  <PeriodReviewPanel
    v-if="activeKey === 'review'"
    @operations="store.openArticle($event)"
    @download="store.downloadOriginal($event)"
  />
  <ChatPanel
    v-else-if="activeKey === 'chat'"
    @operations="store.openArticle($event)"
    @download="store.downloadOriginal($event)"
  />

  <ArticleOperationsDialog
    :article="article"
    :rows="operations"
    :page="operationsPage"
    :pages="operationsPages"
    :loading="operationsLoading"
    :error="operationsError"
    :download-error="downloadError"
    @close="store.closeArticle()"
    @page="store.loadOperationsPage($event)"
    @download="store.downloadOriginal($event)"
  />
</template>
