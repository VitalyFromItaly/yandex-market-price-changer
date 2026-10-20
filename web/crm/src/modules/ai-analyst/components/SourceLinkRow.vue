<script setup lang="ts">
/**
 * Одна ссылка на данные: подпись и период, раскрытие до операций, переход в
 * «Финансы», оригиналы отчёта. Общая у ответа чата и у карточки рекомендации.
 */
import type { SourceLink } from '../ai-analyst.domain';
import type { OpenedArticle } from '@/shared/finance-operations';

import { Download, ListTree, PiggyBank } from 'lucide-vue-next';

import { Button } from '@/components/ui/button';

defineProps<{ source: SourceLink; hideLabel?: boolean }>();
const emit = defineEmits<{ operations: [opened: OpenedArticle]; download: [documentId: string] }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    <span v-if="!hideLabel">
      {{ source.label }}
      <span v-if="source.periodLabel" class="tnum text-muted-foreground">
        · {{ source.periodLabel }}
      </span>
    </span>
    <Button
      v-if="source.operations"
      variant="link"
      size="sm"
      class="h-auto px-0"
      @click="emit('operations', source.operations)"
    >
      <ListTree />
      Операции ({{ source.operations.operationCount ?? source.operations.operationIds.length }})
    </Button>
    <RouterLink
      v-if="source.financeQuery"
      :to="{ name: 'ym-finance', params: { tab: 'pnl' }, query: source.financeQuery }"
      class="inline-flex items-center gap-1 text-link underline-offset-4 hover:underline"
    >
      <PiggyBank class="size-4" />
      В «Финансах»
    </RouterLink>
    <Button
      v-for="documentId in source.documentIds"
      :key="documentId"
      variant="link"
      size="sm"
      class="h-auto px-0"
      @click="emit('download', documentId)"
    >
      <Download />
      Оригинал отчёта
    </Button>
  </div>
</template>
