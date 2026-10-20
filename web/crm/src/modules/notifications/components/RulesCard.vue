<script setup lang="ts">
/**
 * Правила и пороги — одна форма, одна кнопка «Сохранить». Проверяет пороги
 * сервер; ошибка встаёт под своё правило.
 */
import type { NotificationSettings } from '../notifications.domain';

import { computed } from 'vue';

import { useRulesForm } from '../composables/useRulesForm.notifications';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const props = defineProps<{ settings: NotificationSettings }>();

const { form, errors, busy, dirty, submit, discard } = useRulesForm();

/** Правило и его строка формы рядом: строка — локальный черновик, её поля правятся v-model. */
const entries = computed(() =>
  props.settings.rules.flatMap((rule) => {
    const row = form.value?.[rule.key];
    return row === undefined ? [] : [{ rule, row }];
  }),
);

const errorOf = (key: string) =>
  errors.value[`rules.${key}.threshold`] ?? errors.value[`rules.${key}`];
</script>

<template>
  <Form v-if="form" class="gap-4" @submit="submit">
    <Card class="p-0">
      <CardHeader>
        <CardTitle>Правила</CardTitle>
        <CardDescription>
          Проверка — раз в день. Одно событие — одно уведомление, пока его состояние не изменится.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Правило</TableHead>
            <TableHead class="w-44 text-right">Порог</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="{ rule, row } in entries" :key="rule.key">
            <TableCell class="align-top">
              <div class="flex flex-col gap-1">
                <Checkbox v-model="row.enabled" :label="rule.label" :disabled="busy" />
                <span class="text-sm text-muted-foreground">{{ rule.description }}</span>
                <span v-if="errorOf(rule.key)" class="text-sm text-danger" role="alert">
                  {{ errorOf(rule.key) }}
                </span>
              </div>
            </TableCell>
            <TableCell class="align-top">
              <div v-if="rule.unit !== null" class="flex items-center justify-end gap-2">
                <Input
                  v-model="row.threshold"
                  class="w-24 text-right"
                  inputmode="decimal"
                  :aria-label="`Порог «${rule.label}», ${rule.unitLabel}`"
                  :aria-invalid="errorOf(rule.key) ? 'true' : undefined"
                  :disabled="busy || !row.enabled"
                />
                <span class="w-8 text-sm text-muted-foreground">{{ rule.unitLabel }}</span>
              </div>
              <span v-else class="block text-right text-sm text-muted-foreground">—</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
    <Alert v-if="errors.form">{{ errors.form }}</Alert>
    <div class="flex gap-2">
      <Button type="submit" :disabled="busy || !dirty">Сохранить</Button>
      <Button type="button" variant="outline" :disabled="busy || !dirty" @click="discard">
        Отменить
      </Button>
    </div>
  </Form>
</template>
