<script setup lang="ts">
/**
 * Карточка товара: атрибуты, себестоимость и её история, карточки площадок.
 * Правка закупа ложится в историю с сегодняшнего дня; отвязка карточки
 * отправляет её в очередь «не сопоставлено».
 */
import { ArrowLeft, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';

import ProductCostCard from '../components/ProductCostCard.vue';
import ProductLinksCard from '../components/ProductLinksCard.vue';
import PurchaseEditDialog from '../components/PurchaseEditDialog.vue';
import { usePurchaseEditDialog } from '../composables/usePurchaseEditDialog.products';
import { useUnlinkConfirm } from '../composables/useUnlinkConfirm.products';
import { PRODUCTS_ROUTE_NAME } from '../products.domain';
import { useProductsStore } from '../store/store.products';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';

const route = useRoute();
const store = useProductsStore();
const auth = useAuthStore();
const { card, cardError } = storeToRefs(store);

const productId = computed(() => String(route.params.id ?? ''));
const shown = computed(() => (card.value?.id === productId.value ? card.value : null));
const editing = usePurchaseEditDialog();
const unlinking = useUnlinkConfirm();
const busy = computed(() => editing.busy.value || unlinking.busy.value);

const attributes = computed(() => {
  const c = shown.value;
  if (c === null) return [];
  return [
    { label: 'Категория', value: c.category },
    { label: 'Бренд на карточке', value: c.vendor },
    { label: 'Артикул производителя', value: c.vendorCode },
    { label: 'Штрихкоды', value: c.barcodes.length > 0 ? c.barcodes.join(', ') : null },
  ];
});

watch(productId, (id) => void store.loadCard(id), { immediate: true });
</script>

<template>
  <PageHeader
    :title="shown?.name ?? shown?.internalSku ?? 'Товар'"
    :description="shown ? `Артикул ${shown.internalSku}` : undefined"
  >
    <template #actions>
      <Button variant="outline" as-child>
        <RouterLink :to="{ name: PRODUCTS_ROUTE_NAME }"><ArrowLeft /> Все товары</RouterLink>
      </Button>
    </template>
  </PageHeader>

  <div v-if="cardError && !shown" class="flex flex-col items-start gap-3">
    <Alert>{{ cardError }}</Alert>
    <Button variant="outline" @click="store.loadCard(productId)">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!shown" class="flex max-w-4xl flex-col gap-6" aria-busy="true">
    <Skeleton class="h-48 w-full" />
    <Skeleton class="h-40 w-full" />
  </div>

  <div v-else class="flex max-w-4xl flex-col gap-6">
    <ProductCostCard
      :card="shown"
      :me="auth.me?.telegramUserId"
      :busy="busy"
      @edit="editing.show()"
    />
    <ProductLinksCard :links="shown.links" :busy="busy" @unlink="unlinking.ask" />
    <Card>
      <CardContent class="pt-6">
        <dl class="grid gap-3 sm:grid-cols-2">
          <div v-for="row in attributes" :key="row.label" class="flex flex-col gap-0.5">
            <dt class="text-xs text-muted-foreground">{{ row.label }}</dt>
            <dd class="text-sm">{{ row.value ?? '—' }}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>

    <PurchaseEditDialog
      v-model:open="editing.open.value"
      v-model:form="editing.form.value"
      :currencies="shown.currencies"
      :errors="editing.errors.value"
      :busy="editing.busy.value"
      @save="editing.save()"
    />
  </div>

  <ConfirmDialog
    v-model:open="unlinking.open.value"
    :title="unlinking.title.value"
    description="Автомат её больше не привяжет: карточка уйдёт в «Не сопоставлено», привязать можно оттуда."
    confirm-label="Отвязать"
    destructive
    :busy="unlinking.busy.value"
    @confirm="unlinking.confirm()"
  />
</template>
