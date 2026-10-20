<script setup lang="ts">
/** Карточка профиля: факты «ключ — значение» и открытые функции. */
import type { Profile } from '../profile.domain';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

defineProps<{ profile: Profile }>();
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-6">
    <Card>
      <CardContent class="pt-5">
        <dl class="flex flex-col">
          <div
            v-for="row in profile.facts"
            :key="row.label"
            class="flex items-baseline justify-between gap-4 py-1.5"
          >
            <dt class="text-sm text-muted-foreground">{{ row.label }}</dt>
            <dd :class="cn('text-right text-sm', row.muted && 'text-muted-foreground')">
              {{ row.value }}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Открытые функции</CardTitle>
        <CardDescription>
          Что вам доступно в боте и CRM. Закрытое открывает администратор.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="profile.features.length" class="flex flex-wrap gap-2">
          <Badge v-for="feature in profile.features" :key="feature.key">
            {{ feature.label }}
          </Badge>
        </div>
        <p v-else class="text-sm text-muted-foreground">Ни одна функция пока не открыта.</p>
      </CardContent>
    </Card>
  </div>
</template>
