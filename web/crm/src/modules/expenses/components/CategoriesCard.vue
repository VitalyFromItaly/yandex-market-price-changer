<script setup lang="ts">
/**
 * Свои категории продавца рядом с предустановленными. Удалить можно только
 * свою и только свободную — занятую сервер не отдаст (409).
 */
import type { ExpenseCategory } from '../expenses.domain';

import { Plus, X } from 'lucide-vue-next';

import { useCategoryForm } from '../composables/useCategoryForm.expenses';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

defineProps<{ categories: ExpenseCategory[]; nameMaxLength: number }>();
const emit = defineEmits<{ remove: [ExpenseCategory] }>();

const { name, error, busy, add } = useCategoryForm();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Категории</CardTitle>
      <CardDescription>Добавьте свою, если расхода нет в списке.</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        <Badge v-for="category in categories" :key="category.key" variant="outline">
          {{ category.label }}
          <Button
            v-if="category.custom"
            variant="ghost"
            size="icon"
            class="size-4 text-muted-foreground"
            :aria-label="`Удалить категорию ${category.label}`"
            @click="emit('remove', category)"
          >
            <X class="size-3" />
          </Button>
        </Badge>
      </div>

      <Form class="flex flex-row items-start gap-2" @submit="add">
        <FormField
          id="expense-category-name"
          v-slot="{ attrs }"
          label="Новая категория"
          :error="error"
          class="flex-1"
        >
          <Input
            v-bind="attrs"
            v-model="name"
            :maxlength="nameMaxLength"
            placeholder="Например, реклама у блогеров"
            :disabled="busy"
          />
        </FormField>
        <Button type="submit" variant="outline" class="mt-6" :disabled="busy || !name.trim()">
          <Plus />
          Добавить
        </Button>
      </Form>
    </CardContent>
  </Card>
</template>
