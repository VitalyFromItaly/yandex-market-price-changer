<script setup lang="ts">
/** Статус месяца: «Предварительные данные» / «Проверено» / «Есть расхождения» и почему. */
import type { MonthStatusModel } from '../finance.domain';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{ model: MonthStatusModel }>();
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{{ model.label }}</CardTitle>
        <Badge :variant="model.tone">{{ model.statusLabel }}</Badge>
      </div>
    </CardHeader>
    <CardContent>
      <ul class="grid gap-1 text-sm text-muted-foreground">
        <li v-for="line in model.lines" :key="line">{{ line }}</li>
      </ul>
    </CardContent>
  </Card>
</template>
