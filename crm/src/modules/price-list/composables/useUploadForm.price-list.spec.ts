import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { usePriceListStore } from '../store/store.price-list';

import { useUploadForm } from './useUploadForm.price-list';

describe('useUploadForm', () => {
  beforeEach(() => setActivePinia(createPinia()));

  function setup(stockOpen: boolean) {
    const store = usePriceListStore();
    const upload = vi.spyOn(store, 'upload').mockResolvedValue();
    const form = useUploadForm(ref(stockOpen), ref('s1'));
    form.selectFile(new File(['x'], 'прайс.xlsx'));
    return { form, upload };
  }

  it('живая запись остатков — сперва подтверждение, отправка по «да»', async () => {
    const { form, upload } = setup(true);

    await form.submit();
    expect(form.confirmOpen.value).toBe(true);
    expect(upload).not.toHaveBeenCalled();

    await form.confirm();
    expect(form.confirmOpen.value).toBe(false);
    expect(upload).toHaveBeenCalledWith(expect.any(File), false, 's1');
  });

  it('«только проверка» — без подтверждения', async () => {
    const { form, upload } = setup(true);
    form.dryRun.value = true;

    await form.submit();

    expect(form.confirmOpen.value).toBe(false);
    expect(upload).toHaveBeenCalledWith(expect.any(File), true, 's1');
  });

  it('фича остатков закрыта — записи не будет, подтверждать нечего', async () => {
    const { form, upload } = setup(false);
    await form.submit();
    expect(upload).toHaveBeenCalled();
  });
});
