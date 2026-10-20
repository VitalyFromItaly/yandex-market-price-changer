import type { Ref } from 'vue';

import { ref } from 'vue';

import { usePriceListStore } from '../store/store.price-list';

/**
 * Форма загрузки: файл, «только проверка» и подтверждение перед записью.
 *
 * Подтверждение — перед всем, что может уйти в Маркет: запись остатков
 * меняет склад, и откатить её нечем. Не спрашиваем, когда записи заведомо не
 * будет: «проверка» или закрытая фича остатков.
 */
export function useUploadForm(
  stockUpdateOpen: Readonly<Ref<boolean>>,
  /** Ключ открытого магазина — остатки пишутся на его склад. */
  storeKey: Readonly<Ref<string>>,
) {
  const store = usePriceListStore();
  const file = ref<File | null>(null);
  const dryRun = ref(false);
  const confirmOpen = ref(false);

  function selectFile(next: File | null): void {
    file.value = next;
    store.clearFileError();
  }

  async function send(): Promise<void> {
    confirmOpen.value = false;
    if (file.value !== null) await store.upload(file.value, dryRun.value, storeKey.value);
  }

  async function submit(): Promise<void> {
    if (file.value === null) return;
    if (!dryRun.value && stockUpdateOpen.value) {
      confirmOpen.value = true;
      return;
    }
    await send();
  }

  return { file, dryRun, confirmOpen, selectFile, submit, confirm: send };
}
