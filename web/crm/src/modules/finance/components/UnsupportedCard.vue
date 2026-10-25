<script setup lang="ts">
/**
 * Вкладка, которой у площадки нет (TASK-180): причина вместо нулей и пустого
 * списка — «пусто» читалось бы как «всё чисто».
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{
  title: string;
  note: string;
}>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ title }}</CardTitle>
    </CardHeader>
    <CardContent>
      <p class="text-sm text-muted-foreground">{{ note }}</p>
    </CardContent>
  </Card>
</template>
