<script setup lang="ts">
/** История изменений ручной операции (TASK-208): что было и что стало, кто и когда. */
import type { ManualOperationChange } from '../accounting.domain';

import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatSavedAt } from '@/shared/utils';

defineProps<{ items: ManualOperationChange[]; loading: boolean; error: string | null }>();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>История изменений</DialogTitle>
        <DialogDescription>Каждая правка и удаление остаются в истории.</DialogDescription>
      </DialogHeader>
      <Alert v-if="error">{{ error }}</Alert>
      <Skeleton v-else-if="loading" class="h-24" />
      <ol v-else class="flex flex-col gap-3">
        <li v-for="item in items" :key="item.id" class="flex flex-col gap-1">
          <div class="text-sm">
            <span class="font-medium">{{ item.actionLabel }}</span>
            <span class="text-muted-foreground">
              · {{ formatSavedAt(item.createdAt) }}
              <template v-if="item.impersonatedBy"> · администратор за продавца</template>
            </span>
          </div>
          <ul class="text-xs text-muted-foreground">
            <li v-for="change in item.changes" :key="change.field">
              {{ change.field }}:
              <template v-if="change.before !== null && change.after !== null">
                {{ change.before }} → {{ change.after }}
              </template>
              <template v-else>{{ change.after ?? change.before }}</template>
            </li>
          </ul>
        </li>
      </ol>
    </DialogContent>
  </Dialog>
</template>
