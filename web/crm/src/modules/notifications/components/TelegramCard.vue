<script setup lang="ts">
/**
 * Отправка в Telegram (фича `notifications_telegram`): тумблер и время по
 * Москве — то же, что ряд «🔔 Уведомления» в «⏰ Рассылке» бота.
 */
import { useTelegramForm } from '../composables/useTelegramForm.notifications';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

const { enabled, time, errors, busy, timeDirty, saveTime } = useTelegramForm();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Telegram</CardTitle>
      <CardDescription>
        Новые уведомления — одной сводкой в бот в выбранное время. Время — по Москве.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4 sm:flex-row sm:items-end">
      <Checkbox v-model="enabled" label="Присылать в Telegram" :disabled="busy" class="sm:mb-2" />
      <FormField id="notify-time" v-slot="{ attrs }" label="Время проверки" :error="errors.time">
        <Input v-bind="attrs" v-model="time" class="w-28" placeholder="09:00" :disabled="busy" />
      </FormField>
      <Button variant="outline" :disabled="busy || !timeDirty" @click="saveTime">
        Сохранить время
      </Button>
    </CardContent>
    <p v-if="errors.form" class="px-6 pb-4 text-sm text-danger" role="alert">{{ errors.form }}</p>
  </Card>
</template>
