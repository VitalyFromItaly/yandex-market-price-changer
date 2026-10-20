<script setup lang="ts">
/**
 * Ключ Ozon Seller API. Новый ключ сначала проверяется в Ozon; если не подойдёт,
 * останется прежний.
 */
import { computed } from 'vue';

import { useOzonConnectForm } from '../composables/useOzonConnectForm.marketplaces';

import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

const emit = defineEmits<{ done: []; cancel: [] }>();

const { clientId, apiKey, errors, busy, submit } = useOzonConnectForm(() => emit('done'));
const filled = computed(() => clientId.value.trim() !== '' && apiKey.value.trim() !== '');
</script>

<template>
  <Form class="flex flex-col gap-3" @submit="submit">
    <div class="grid gap-3 sm:grid-cols-2">
      <FormField id="ozon-client-id" v-slot="{ attrs }" label="Client-Id" :error="errors.clientId">
        <Input
          v-bind="attrs"
          v-model="clientId"
          inputmode="numeric"
          autocomplete="off"
          placeholder="1234567"
        />
      </FormField>
      <FormField id="ozon-api-key" v-slot="{ attrs }" label="Api-Key" :error="errors.apiKey">
        <Input v-bind="attrs" v-model="apiKey" type="password" autocomplete="off" />
      </FormField>
    </div>
    <p class="text-xs text-muted-foreground">
      Client-Id и Api-Key — в личном кабинете Ozon: Настройки → Seller API.
    </p>
    <div class="flex flex-wrap gap-2">
      <Button type="submit" :disabled="busy || !filled">
        {{ busy ? 'Проверяю…' : 'Проверить и сохранить' }}
      </Button>
      <Button type="button" variant="ghost" :disabled="busy" @click="emit('cancel')">
        Отмена
      </Button>
    </div>
  </Form>
</template>
