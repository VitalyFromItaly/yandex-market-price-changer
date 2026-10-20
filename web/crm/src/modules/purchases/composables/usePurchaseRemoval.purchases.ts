import type { Purchase, TaxPayment } from '../purchases.domain';

import { computed, ref } from 'vue';

import { usePurchasesStore } from '../store/store.purchases';

import { toast } from '@/components/ui/toast';

type TTarget = { kind: 'purchase'; purchase: Purchase } | { kind: 'tax'; payment: TaxPayment };

/** Удаление закупки или уплаты налога — через одно подтверждение. */
export function usePurchaseRemoval() {
  const store = usePurchasesStore();

  const open = ref(false);
  const target = ref<TTarget | null>(null);
  const busy = ref(false);

  const title = computed(() =>
    target.value?.kind === 'tax' ? 'Удалить уплату налога?' : 'Удалить закупку?',
  );

  function askPurchase(purchase: Purchase): void {
    target.value = { kind: 'purchase', purchase };
    open.value = true;
  }

  function askTax(payment: TaxPayment): void {
    target.value = { kind: 'tax', payment };
    open.value = true;
  }

  async function confirm(): Promise<void> {
    const current = target.value;
    if (current === null) return;
    busy.value = true;
    try {
      if (current.kind === 'purchase') {
        await store.remove(current.purchase.id);
        toast.success('Удалено', `Закупка у «${current.purchase.supplier}»`);
      } else {
        await store.removeTax(current.payment.id);
        toast.success('Удалено', 'Уплата налога');
      }
    } catch (e) {
      toast.error('Не удалось удалить', e instanceof Error ? e.message : undefined);
    } finally {
      busy.value = false;
      open.value = false;
    }
  }

  return { open, target, busy, title, askPurchase, askTax, confirm };
}
