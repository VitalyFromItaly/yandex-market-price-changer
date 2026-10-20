<script setup lang="ts">
/**
 * Состояние отчёта-файла Маркета («Платежи», «Отчёты Маркета»): ещё не
 * заказан, собирается, не собрался, данных нет, готов. «Данных нет» — не
 * ошибка: Маркет собрал отчёт, но за период ему нечего положить в файл.
 * Кнопка скачивания — в шапке страницы, здесь только состояние.
 */
import { FileCheck2, FileQuestion, FileX2, RotateCw } from 'lucide-vue-next';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  /** Задачи ещё не было — продавец не нажимал «Сформировать». */
  idle: boolean;
  loading: boolean;
  error: string | null;
  /** Текст «данных нет» от сервера; null — файл есть. */
  emptyText: string | null;
  filename: string | null;
  /** Что именно собрано: период, месяц, детализация. */
  caption: string | null;
}>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <EmptyState
    v-if="idle"
    :icon="FileQuestion"
    title="Отчёт ещё не заказан"
    description="Выберите параметры и нажмите «Сформировать». Отчёт готовит сам Маркет — обычно минуту-другую."
  />

  <div v-else-if="error" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="emit('retry')">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="loading" class="flex flex-col gap-3" aria-busy="true">
    <p class="text-sm text-muted-foreground">
      Маркет готовит отчёт — обычно минуту-другую, страницу можно не держать открытой.
    </p>
    <Skeleton class="h-24 w-full" />
  </div>

  <EmptyState
    v-else-if="emptyText"
    :icon="FileX2"
    :title="emptyText"
    :description="caption ?? undefined"
  />

  <EmptyState
    v-else-if="filename"
    :icon="FileCheck2"
    title="Отчёт готов"
    :description="[caption, filename].filter(Boolean).join(' · ')"
  />
</template>
