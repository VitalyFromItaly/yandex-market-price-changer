<script setup lang="ts">
/**
 * Карточки площадок товара: артикул, как привязана и цена продажи. Все три
 * площадки — пустые тоже, чтобы «не привязана» было видно, а не угадывалось.
 */
import type { ProductLink } from '../products.domain';

import { Unlink } from 'lucide-vue-next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRub } from '@/shared/utils';

defineProps<{ links: ProductLink[]; busy: boolean }>();
const emit = defineEmits<{ unlink: [link: ProductLink] }>();
</script>

<template>
  <Card>
    <CardHeader><CardTitle>Карточки площадок</CardTitle></CardHeader>
    <CardContent>
      <ul class="flex flex-col divide-y">
        <li
          v-for="link in links"
          :key="link.marketplace"
          class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium">{{ link.label }}</span>
            <span v-if="link.sku" class="font-mono text-sm">{{ link.sku }}</span>
            <span v-else class="text-sm text-muted-foreground">не привязана</span>
            <span v-if="link.sourceText" class="text-xs text-muted-foreground">
              привязана {{ link.sourceText }}
            </span>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="link.salePrice !== null" class="tnum text-sm text-muted-foreground">
              цена {{ formatRub(link.salePrice) }}
            </span>
            <Button
              v-if="link.sku"
              variant="ghost"
              size="sm"
              :disabled="busy"
              @click="emit('unlink', link)"
            >
              <Unlink />
              Отвязать
            </Button>
          </div>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
