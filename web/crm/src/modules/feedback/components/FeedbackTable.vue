<script setup lang="ts">
/**
 * Отзывы без ответа: оценка, текст, автор, заказ, дата и два действия. Товара
 * нет — Partner API его не отдаёт, есть только номер заказа. Чего Маркет не
 * прислал, того нет в строке: «—», а не пустая строка и не ноль звёзд.
 */
import type { FeedbackRow } from '../feedback.domain';

import { MessageSquareReply, SkipForward } from 'lucide-vue-next';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{
  rows: FeedbackRow[];
  disabled: boolean;
  hasDraft: (feedbackId: number) => boolean;
}>();
const emit = defineEmits<{
  reply: [feedbackId: number];
  skip: [feedbackId: number];
}>();
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-28">Оценка</TableHead>
          <TableHead>Отзыв</TableHead>
          <TableHead class="hidden md:table-cell">Заказ</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Дата</TableHead>
          <TableHead class="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.feedbackId" class="align-top">
          <TableCell
            class="whitespace-nowrap"
            :aria-label="row.rating === null ? 'Без оценки' : `Оценка ${row.rating} из 5`"
          >
            <template v-if="row.stars">{{ row.stars }}</template>
            <span v-else class="text-muted-foreground">—</span>
          </TableCell>
          <TableCell class="max-w-[36rem] text-sm">
            <div class="font-medium">{{ row.author ?? 'Покупатель' }}</div>
            <p v-for="part in row.parts" :key="part.label" class="mt-1 whitespace-pre-line">
              <span class="text-muted-foreground">{{ part.label }}:</span> {{ part.text }}
            </p>
            <p v-if="row.parts.length === 0" class="mt-1 italic text-muted-foreground">
              Без текста — только оценка.
            </p>
            <p class="mt-1 text-muted-foreground sm:hidden">{{ row.date ?? '' }}</p>
          </TableCell>
          <TableCell class="tnum hidden text-sm text-muted-foreground md:table-cell">
            {{ row.orderId === null ? '—' : `№ ${row.orderId}` }}
          </TableCell>
          <TableCell class="tnum hidden whitespace-nowrap text-right text-sm sm:table-cell">
            {{ row.date ?? '—' }}
          </TableCell>
          <TableCell class="text-right">
            <div class="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                :disabled="disabled"
                :aria-label="`Ответить на отзыв ${row.author ?? 'покупателя'}`"
                @click="emit('reply', row.feedbackId)"
              >
                <MessageSquareReply />
                {{ hasDraft(row.feedbackId) ? 'Черновик' : 'Ответить' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                :disabled="disabled"
                :aria-label="`Пропустить отзыв ${row.author ?? 'покупателя'}`"
                @click="emit('skip', row.feedbackId)"
              >
                <SkipForward />
                Пропустить
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
