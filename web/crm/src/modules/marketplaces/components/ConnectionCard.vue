<script setup lang="ts">
/**
 * Карточка площадки на «Подключениях»: работает ли ключ, какой он (маска),
 * когда его последний раз подтвердила площадка и что открывает. «Проверить
 * связь» ключ не меняет; «Заменить ключ» раскрывает форму площадки (слот
 * `form`), и новый ключ тоже проверяется до записи.
 */
import type { ConnectionCard } from '../marketplaces.domain';

import { RefreshCw } from 'lucide-vue-next';
import { computed, ref } from 'vue';

import { checkedLabel } from '../mappers/mapMarketplaces.marketplaces';
import { CONNECTION_STATUS_LABEL, CONNECTION_STATUS_VARIANT } from '../marketplaces.domain';

import MarketplaceMark from '@/components/layout/MarketplaceMark.vue';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const props = defineProps<{ card: ConnectionCard; checking: boolean }>();
const emit = defineEmits<{ check: [] }>();

const editing = ref(false);

/** Записан ли ключ: у Ozon/WB подключение могло быть отвергнуто, но ключ лежит. */
const hasKey = computed(() => props.card.keyHint !== null || props.card.connected);
const checked = computed(() => checkedLabel(props.card));
const accounts = computed(() => props.card.accounts.join(', '));

function close(): void {
  editing.value = false;
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-center gap-3">
        <MarketplaceMark :marketplace="card.key" :muted="!card.available" size="md" />
        <CardTitle class="flex-1">{{ card.label }}</CardTitle>
        <Badge v-if="!card.available" variant="outline">скоро</Badge>
        <Badge v-else :variant="CONNECTION_STATUS_VARIANT[card.status]">
          {{ CONNECTION_STATUS_LABEL[card.status] }}
        </Badge>
      </div>
      <CardDescription v-if="!card.available">
        Площадку ещё не открыли для вашего аккаунта — подключить ключ можно будет здесь же.
      </CardDescription>
    </CardHeader>

    <CardContent v-if="card.available" class="flex flex-col gap-4">
      <dl v-if="hasKey" class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt class="text-muted-foreground">Ключ</dt>
        <dd class="font-mono tnum">{{ card.keyHint ?? '••••' }}</dd>
        <template v-if="checked">
          <dt class="text-muted-foreground">Проверка</dt>
          <dd>{{ checked }}</dd>
        </template>
        <template v-if="accounts">
          <dt class="text-muted-foreground">
            {{ card.key === 'ym' ? 'Магазины' : 'Кабинет' }}
          </dt>
          <dd>{{ accounts }}</dd>
        </template>
      </dl>
      <p v-else class="text-sm text-muted-foreground">Ключ не добавлен.</p>

      <Alert v-if="card.checkError && card.status !== 'ok'">{{ card.checkError }}</Alert>

      <slot v-if="editing" name="form" :close="close" />
      <div v-else class="flex flex-wrap gap-2">
        <Button v-if="hasKey" variant="outline" :disabled="checking" @click="emit('check')">
          <RefreshCw :class="checking ? 'animate-spin' : ''" />
          {{ checking ? 'Проверяю…' : 'Проверить связь' }}
        </Button>
        <Button :variant="hasKey ? 'ghost' : 'default'" @click="editing = true">
          {{ hasKey ? 'Заменить ключ' : 'Добавить ключ' }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
