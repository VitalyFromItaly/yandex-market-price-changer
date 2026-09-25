<script setup lang="ts">
import { useLoginForm } from '../composables/useLoginForm.auth';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

const { form, busy, error, submit } = useLoginForm();
</script>

<template>
  <Form @submit="submit">
    <FormField id="login" v-slot="{ attrs }" label="Ник или Telegram id">
      <Input
        v-bind="attrs"
        v-model="form.login"
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        placeholder="@nick или 123456789"
        :disabled="busy"
      />
    </FormField>
    <FormField id="password" v-slot="{ attrs }" label="Пароль">
      <Input
        v-bind="attrs"
        v-model="form.password"
        type="password"
        autocomplete="current-password"
        :disabled="busy"
      />
    </FormField>
    <Alert v-if="error">{{ error }}</Alert>
    <Button type="submit" :disabled="busy">{{ busy ? 'Входим…' : 'Войти' }}</Button>
  </Form>
</template>
