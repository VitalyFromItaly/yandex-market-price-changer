<script setup lang="ts">
import { MIN_PASSWORD_LENGTH } from '../auth.domain';
import { usePasswordForm } from '../composables/usePasswordForm.auth';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

/** Одна форма на оба входа: принудительная смена стартового пароля и «Безопасность». */
const emit = defineEmits<{ done: [] }>();

const { form, errors, busy, submit } = usePasswordForm(() => emit('done'));
</script>

<template>
  <Form @submit="submit">
    <FormField
      id="current-password"
      v-slot="{ attrs }"
      label="Текущий пароль"
      :error="errors.current"
    >
      <Input
        v-bind="attrs"
        v-model="form.current"
        type="password"
        autocomplete="current-password"
        :disabled="busy"
      />
    </FormField>
    <FormField
      id="new-password"
      v-slot="{ attrs }"
      :label="`Новый пароль — не короче ${MIN_PASSWORD_LENGTH} символов`"
      :error="errors.next"
    >
      <Input
        v-bind="attrs"
        v-model="form.next"
        type="password"
        autocomplete="new-password"
        :disabled="busy"
      />
    </FormField>
    <FormField
      id="repeat-password"
      v-slot="{ attrs }"
      label="Повторите новый пароль"
      :error="errors.repeat"
    >
      <Input
        v-bind="attrs"
        v-model="form.repeat"
        type="password"
        autocomplete="new-password"
        :disabled="busy"
      />
    </FormField>
    <Alert v-if="errors.form">{{ errors.form }}</Alert>
    <Button type="submit" :disabled="busy">{{ busy ? 'Сохраняем…' : 'Сменить пароль' }}</Button>
  </Form>
</template>
