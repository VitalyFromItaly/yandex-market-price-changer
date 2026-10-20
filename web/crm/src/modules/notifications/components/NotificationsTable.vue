<script setup lang="ts">
/** Лента уведомлений: свежие сверху, непрочитанные выделены; «Прочитано» — в последней колонке. */
import type { NotificationItem } from '../notifications.domain';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ items: NotificationItem[]; busy: boolean }>();
const emit = defineEmits<{ read: [id: string] }>();
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-36">Когда</TableHead>
          <TableHead>Уведомление</TableHead>
          <TableHead class="hidden md:table-cell">Правило</TableHead>
          <TableHead class="hidden sm:table-cell">Состояние</TableHead>
          <TableHead class="w-28" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="item in items"
          :key="item.id"
          :class="item.read ? '' : 'bg-brand-subtle/40'"
        >
          <TableCell class="tnum align-top text-muted-foreground">
            {{ item.createdLabel ?? '—' }}
          </TableCell>
          <TableCell class="align-top">
            <div class="flex flex-col gap-1">
              <span :class="item.read ? 'font-medium' : 'font-semibold'">{{ item.title }}</span>
              <span class="whitespace-pre-line text-sm text-muted-foreground">{{ item.body }}</span>
            </div>
          </TableCell>
          <TableCell class="hidden align-top text-sm md:table-cell">
            {{ item.ruleLabel }}
            <span v-if="item.marketplaceLabel" class="text-muted-foreground">
              · {{ item.marketplaceLabel }}
            </span>
          </TableCell>
          <TableCell class="hidden align-top sm:table-cell">
            <Badge :variant="item.active ? 'warn' : 'default'">
              {{ item.active ? 'Актуально' : 'Снято' }}
            </Badge>
          </TableCell>
          <TableCell class="align-top text-right">
            <Button
              v-if="!item.read"
              variant="ghost"
              size="sm"
              :disabled="busy"
              :aria-label="`Прочитано: ${item.title}`"
              @click="emit('read', item.id)"
            >
              Прочитано
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
