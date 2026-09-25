<script setup lang="ts">
/**
 * Смена API-токена. Новый токен проверяется в Маркете до записи: не подошёл —
 * остаётся прежний, и отчёты продолжают работать.
 */
import { useTokenForm } from '../composables/useTokenForm.stores';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

const { token, error, busy, submit } = useTokenForm();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>API-токен</CardTitle>
      <CardDescription>
        Новый токен сначала проверяется в Яндекс.Маркете. Если он не подойдёт, останется прежний.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Form class="flex flex-col gap-4 sm:flex-row sm:items-end" @submit="submit">
        <FormField
          id="market-token"
          v-slot="{ attrs }"
          label="Новый токен"
          :error="error"
          class="flex-1"
        >
          <Input
            v-bind="attrs"
            v-model="token"
            type="password"
            autocomplete="off"
            placeholder="ACMA:…"
          />
        </FormField>
        <Button type="submit" :disabled="busy || token.trim().length === 0">
          {{ busy ? 'Проверяю…' : 'Проверить и сохранить' }}
        </Button>
      </Form>
    </CardContent>
  </Card>
</template>
