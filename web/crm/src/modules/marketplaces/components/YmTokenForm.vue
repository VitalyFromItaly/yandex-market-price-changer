<script setup lang="ts">
/**
 * Новый API-токен Яндекс Маркета. Проверяется в Маркете до записи: не подошёл —
 * остаётся прежний, и отчёты продолжают работать.
 */
import { useYmTokenForm } from '../composables/useYmTokenForm.marketplaces';

import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

const emit = defineEmits<{ done: []; cancel: [] }>();

const { token, error, busy, submit } = useYmTokenForm(() => emit('done'));
</script>

<template>
  <Form class="flex flex-col gap-3" @submit="submit">
    <FormField id="market-token" v-slot="{ attrs }" label="Новый токен" :error="error">
      <Input
        v-bind="attrs"
        v-model="token"
        type="password"
        autocomplete="off"
        placeholder="ACMA:…"
      />
    </FormField>
    <p class="text-xs text-muted-foreground">
      Токен — в кабинете Маркета: Настройки → API и модули → Авторизационные токены.
    </p>
    <div class="flex flex-wrap gap-2">
      <Button type="submit" :disabled="busy || token.trim().length === 0">
        {{ busy ? 'Проверяю…' : 'Проверить и сохранить' }}
      </Button>
      <Button type="button" variant="ghost" :disabled="busy" @click="emit('cancel')">
        Отмена
      </Button>
    </div>
  </Form>
</template>
