import type { ProductLink } from '../products.domain';

import { computed, ref } from 'vue';

import { useProductsStore } from '../store/store.products';

import { toast } from '@/components/ui/toast';

/**
 * Отвязка карточки площадки — через подтверждение: автомат такую карточку
 * больше не привяжет, она уйдёт в очередь «не сопоставлено».
 */
export function useUnlinkConfirm() {
  const store = useProductsStore();

  const open = ref(false);
  const target = ref<ProductLink | null>(null);
  const busy = ref(false);

  const title = computed(() =>
    target.value === null
      ? ''
      : `Отвязать карточку ${target.value.label} ${target.value.sku ?? ''}?`,
  );

  function ask(link: ProductLink): void {
    target.value = link;
    open.value = true;
  }

  async function confirm(): Promise<void> {
    const productId = store.card?.id;
    const link = target.value;
    if (productId === undefined || link === null) return;
    busy.value = true;
    try {
      await store.unlinkCard(productId, link.marketplace);
      open.value = false;
      toast.success('Отвязано', 'Карточка ушла в «Не сопоставлено»');
    } catch (e) {
      toast.error('Не удалось отвязать', e instanceof Error ? e.message : undefined);
    } finally {
      busy.value = false;
    }
  }

  return { open, target, busy, title, ask, confirm };
}
