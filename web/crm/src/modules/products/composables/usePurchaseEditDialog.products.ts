import type { PurchaseErrors, PurchaseForm } from '../products.domain';

import { ref } from 'vue';

import { mapPurchaseError, purchaseBody, toPurchaseForm } from '../mappers/mapProducts.products';
import { useProductsStore } from '../store/store.products';

import { toast } from '@/components/ui/toast';

/**
 * Диалог правки закупа. Проверяет сервер, ошибка встаёт под своё поле;
 * закрывается только после удачной записи. Правка ложится в историю с
 * сегодняшнего дня — прошлые месяцы «Прибыли» она не трогает.
 */
export function usePurchaseEditDialog() {
  const store = useProductsStore();

  const open = ref(false);
  const form = ref<PurchaseForm>(toPurchaseForm(null));
  const errors = ref<PurchaseErrors>({});
  const busy = ref(false);

  function show(): void {
    form.value = toPurchaseForm(store.card);
    errors.value = {};
    open.value = true;
  }

  async function save(): Promise<void> {
    const productId = store.card?.id;
    if (productId === undefined) return;
    busy.value = true;
    errors.value = {};
    try {
      await store.savePurchase(productId, purchaseBody(form.value));
      open.value = false;
      toast.success('Сохранено', 'Закуп действует с сегодняшнего дня');
    } catch (e) {
      errors.value = mapPurchaseError(e, 'Не удалось сохранить закуп');
    } finally {
      busy.value = false;
    }
  }

  return { open, form, errors, busy, show, save };
}
