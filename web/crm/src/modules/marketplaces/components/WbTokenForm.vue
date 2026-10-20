<script setup lang="ts">
/**
 * Токен WB API. Проверяется в WB по категориям до записи: не подошёл — остаётся
 * прежний; не хватает категорий — WB назовёт какие.
 */
import { useWbConnectForm } from '../composables/useWbConnectForm.marketplaces';

import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

const emit = defineEmits<{ done: []; cancel: [] }>();

const { token, error, busy, submit } = useWbConnectForm(() => emit('done'));
</script>

<template>
  <Form class="flex flex-col gap-3" @submit="submit">
    <FormField id="wb-token" v-slot="{ attrs }" label="Токен WB API" :error="error">
      <Input v-bind="attrs" v-model="token" type="password" autocomplete="off" />
    </FormField>
    <p class="text-xs text-muted-foreground">
      Токен — в личном кабинете WB: Настройки → Доступ к API. Отметьте категории «Контент»,
      «Маркетплейс», «Статистика», «Аналитика» и «Финансы»; токен — базовый, не тестовый.
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
