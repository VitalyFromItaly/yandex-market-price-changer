<script setup lang="ts">
/**
 * Уплаченные налоги — вносятся руками: в ДДС идёт только то, что правда ушло
 * (авансы УСН платят раз в квартал). Начисленный налог — в прибыли.
 */
import type { TaxPaymentRow } from '../purchases.domain';

import { Pencil, Plus, Trash2 } from 'lucide-vue-next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{ rows: TaxPaymentRow[]; disabled: boolean }>();
const emit = defineEmits<{ add: []; edit: [id: string]; remove: [id: string] }>();
</script>

<template>
  <Card>
    <CardHeader class="flex flex-row items-start justify-between gap-4">
      <div class="flex flex-col gap-1.5">
        <CardTitle>Уплаченные налоги</CardTitle>
        <CardDescription
          >Для движения денег. Начисленный налог считается в прибыли.</CardDescription
        >
      </div>
      <Button variant="outline" size="sm" :disabled="disabled" @click="emit('add')">
        <Plus />
        Внести уплату
      </Button>
    </CardHeader>
    <CardContent>
      <p v-if="rows.length === 0" class="text-sm text-muted-foreground">Уплат пока нет.</p>
      <ul v-else class="divide-y">
        <li v-for="row in rows" :key="row.id" class="flex items-center gap-4 py-2 text-sm">
          <span class="w-24 shrink-0 text-muted-foreground">{{ row.day }}</span>
          <span class="min-w-0 flex-1 truncate text-muted-foreground" :title="row.note ?? ''">
            {{ row.note }}
          </span>
          <span class="whitespace-nowrap tabular-nums">{{ row.amount }}</span>
          <span class="whitespace-nowrap">
            <Button
              variant="ghost"
              size="sm"
              :aria-label="`Изменить уплату ${row.day}`"
              :disabled="disabled"
              @click="emit('edit', row.id)"
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :aria-label="`Удалить уплату ${row.day}`"
              :disabled="disabled"
              @click="emit('remove', row.id)"
            >
              <Trash2 />
            </Button>
          </span>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
