import type { Purchase, PurchaseErrors, PurchaseForm } from '../purchases.domain';

import { computed, ref } from 'vue';

import { mapPurchaseError, purchaseBody, toPurchaseForm } from '../mappers/mapPurchases.purchases';
import { usePurchasesStore } from '../store/store.purchases';

import { toast } from '@/components/ui/toast';
import { moscowToday } from '@/shared/utils';

/**
 * Диалог закупки: новая или правка — одна форма. Проверяет сервер (в т.ч.
 * Σ позиций = сумма), ошибка встаёт под своё поле; закрывается только после
 * удачной записи.
 */
export function usePurchaseDialog(today: () => string = () => moscowToday()) {
  const store = usePurchasesStore();

  const open = ref(false);
  const editing = ref<Purchase | null>(null);
  const form = ref<PurchaseForm>(toPurchaseForm(null, today()));
  const errors = ref<PurchaseErrors>({});
  const busy = ref(false);

  const title = computed(() => (editing.value === null ? 'Новая закупка' : 'Изменить закупку'));

  function show(purchase: Purchase | null): void {
    editing.value = purchase;
    form.value = toPurchaseForm(purchase, today());
    errors.value = {};
    open.value = true;
  }

  async function save(): Promise<void> {
    busy.value = true;
    errors.value = {};
    const target = editing.value;
    try {
      const body = purchaseBody(form.value);
      if (target === null) await store.create(body);
      else await store.update(target.id, body);
      open.value = false;
      toast.success('Сохранено', target === null ? 'Закупка добавлена' : 'Закупка изменена');
    } catch (e) {
      errors.value = mapPurchaseError(e, 'Не удалось сохранить закупку');
    } finally {
      busy.value = false;
    }
  }

  return {
    open,
    editing,
    form,
    errors,
    busy,
    title,
    openCreate: () => show(null),
    openEdit: (purchase: Purchase) => show(purchase),
    save,
  };
}
