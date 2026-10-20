<script setup lang="ts">
/**
 * Ряд карточек прогноза: крупно — прогноз с меткой «прогноз», под ним — факт и
 * сколько добавят оставшиеся дни. Метка на каждой карточке, а не одна на ряд:
 * карточку видят отдельно от заголовка.
 */
import type { ForecastCard, Tone } from '../forecast.domain';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{ cards: ForecastCard[] }>();

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-ok',
  danger: 'text-danger',
  muted: 'text-foreground',
};
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <Card v-for="card in cards" :key="card.key">
      <CardHeader class="flex flex-row items-center justify-between gap-2">
        <CardTitle class="text-sm font-medium text-muted-foreground">{{ card.title }}</CardTitle>
        <Badge variant="outline">прогноз</Badge>
      </CardHeader>
      <CardContent class="flex flex-col gap-1">
        <span class="tnum text-2xl font-semibold" :class="TONE_CLASS[card.tone]">
          {{ card.value }}
        </span>
        <span class="text-xs text-muted-foreground">{{ card.caption }}</span>
      </CardContent>
    </Card>
  </div>
</template>
