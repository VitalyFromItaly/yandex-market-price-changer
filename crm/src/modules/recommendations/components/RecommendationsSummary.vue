<script setup lang="ts">
/** Итоги среза — те же счётчики, что сообщение бота: всего, умеренная, непривлекательная. */
import type { RecommendationsReport } from '../recommendations.domain';

import { Info } from 'lucide-vue-next';

import { Card, CardContent } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { formatCount } from '@/shared/utils';

defineProps<{ report: RecommendationsReport }>();
</script>

<template>
  <Card>
    <CardContent class="pt-5">
      <dl class="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div>
          <dt class="flex items-center gap-1.5 text-sm text-muted-foreground">
            Товаров с непривлекательной ценой
            <Tooltip
              text="Маркет присылает только товары, цена которых выше привлекательной. Товары с привлекательной ценой в список не попадают."
            >
              <button type="button" class="text-muted-foreground" aria-label="Что сюда попадает">
                <Info class="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </dt>
          <dd class="tnum mt-1 text-2xl font-semibold">{{ formatCount(report.count) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted-foreground">Умеренная цена</dt>
          <dd class="tnum mt-1 text-2xl font-semibold">{{ formatCount(report.average) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted-foreground">Непривлекательная</dt>
          <dd class="tnum mt-1 text-2xl font-semibold">{{ formatCount(report.low) }}</dd>
          <dd v-if="report.other" class="tnum mt-1 text-sm text-muted-foreground">
            прочие: {{ formatCount(report.other) }}
          </dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</template>
