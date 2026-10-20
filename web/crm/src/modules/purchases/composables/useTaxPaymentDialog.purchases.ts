import type { PurchaseErrors, TaxPayment, TaxPaymentForm } from '../purchases.domain';

import { computed, ref } from 'vue';

import {
  mapPurchaseError,
  taxPaymentBody,
  toTaxPaymentForm,
} from '../mappers/mapPurchases.purchases';
import { usePurchasesStore } from '../store/store.purchases';

import { toast } from '@/components/ui/toast';
import { moscowToday } from '@/shared/utils';

/** Диалог уплаты налога: дата, сумма, комментарий. Логика — как у закупки. */
export function useTaxPaymentDialog(today: () => string = () => moscowToday()) {
  const store = usePurchasesStore();

  const open = ref(false);
  const editing = ref<TaxPayment | null>(null);
  const form = ref<TaxPaymentForm>(toTaxPaymentForm(null, today()));
  const errors = ref<PurchaseErrors>({});
  const busy = ref(false);

  const title = computed(() => (editing.value === null ? 'Уплата налога' : 'Изменить уплату'));

  function show(payment: TaxPayment | null): void {
    editing.value = payment;
    form.value = toTaxPaymentForm(payment, today());
    errors.value = {};
    open.value = true;
  }

  async function save(): Promise<void> {
    busy.value = true;
    errors.value = {};
    const target = editing.value;
    try {
      const body = taxPaymentBody(form.value);
      if (target === null) await store.createTax(body);
      else await store.updateTax(target.id, body);
      open.value = false;
      toast.success('Сохранено', 'Уплата налога записана');
    } catch (e) {
      errors.value = mapPurchaseError(e, 'Не удалось сохранить уплату');
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
    openEdit: (payment: TaxPayment) => show(payment),
    save,
  };
}
