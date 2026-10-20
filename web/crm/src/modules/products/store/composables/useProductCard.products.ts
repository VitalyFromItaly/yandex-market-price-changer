import type { LinkBody, MarketplaceKey, ProductCard, PurchaseBody } from '../../products.domain';

import { ref } from 'vue';

import { productsApi } from '../../api/productsApi.products';

import { useBaseState } from '@/shared/composables';

/**
 * Карточка товара: загрузка, правка закупа, привязка и отвязка карточки
 * площадки. Каждая запись заменяет карточку ответом сервера; ошибки записей
 * пробрасываются — под какое поле их ставить, решает форма.
 */
export function useProductCard() {
  const [card, setCard, isLoading, resetCard] = useBaseState<ProductCard | null>(null);
  const error = ref<string | null>(null);
  let generation = 0;

  async function load(productId: string): Promise<void> {
    const run = ++generation;
    // Карточка другого товара не должна мелькнуть под новым адресом.
    if (card.value?.id !== productId) resetCard();
    isLoading.value = true;
    error.value = null;
    try {
      const next = await productsApi.card(productId);
      if (run === generation) setCard(next);
    } catch (caught) {
      if (run === generation) {
        error.value = caught instanceof Error ? caught.message : 'Не удалось загрузить товар';
      }
    } finally {
      if (run === generation) isLoading.value = false;
    }
  }

  async function apply(request: Promise<ProductCard>): Promise<void> {
    generation += 1;
    setCard(await request);
  }

  const savePurchase = (productId: string, body: PurchaseBody) =>
    apply(productsApi.updatePurchase(productId, body));
  const link = (productId: string, body: LinkBody) => apply(productsApi.link(productId, body));
  const unlink = (productId: string, marketplace: MarketplaceKey) =>
    apply(productsApi.unlink(productId, marketplace));

  function reset(): void {
    generation += 1;
    resetCard();
    error.value = null;
  }

  return { card, isLoading, error, load, savePurchase, link, unlink, reset };
}
