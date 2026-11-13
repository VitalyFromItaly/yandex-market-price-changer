import type { ManualOperation, ManualOperationsView } from '../accounting.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import {
  useManualOperationDialog,
  useManualOperationRemoval,
} from './useManualOperationDialog.accounting';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({
  sync: vi.fn(),
  manual: vi.fn(),
  createManual: vi.fn(),
  updateManual: vi.fn(),
  removeManual: vi.fn(),
  manualHistory: vi.fn(),
}));
vi.mock('../api/accountingApi.accounting', () => ({ accountingApi: api }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const VIEW: ManualOperationsView = {
  items: [],
  options: { marketplaces: [], articles: [], subArticles: [] },
  limits: { source: 200, documentNumber: 100, ref: 100, note: 500 },
};
const OP: ManualOperation = {
  id: 'm1',
  marketplace: 'ozon',
  marketplaceLabel: 'Ozon',
  article: 'compensations',
  articleLabel: 'Компенсации',
  subArticle: null,
  subArticleLabel: null,
  amountKopecks: -150050,
  accruedOn: '2026-10-15',
  orderId: null,
  sku: 'A1',
  source: 'Акт сверки',
  documentNumber: null,
  note: null,
  createdAt: '2026-10-15T10:00:00Z',
  updatedAt: '2026-10-15T10:00:00Z',
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia();
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('useManualOperationDialog', () => {
  it('новая: ключ формы один на все отправки, сбой — ошибка под полем, удача закрывает', async () => {
    const dialog = useManualOperationDialog(() => '2026-11-08');
    dialog.openCreate();
    expect(dialog.form.value.accruedOn).toBe('2026-11-08');
    dialog.form.value = { ...dialog.form.value, amount: '-100', source: '' };

    api.createManual.mockRejectedValueOnce(
      new ApiError('Укажите источник', 400, 'INVALID_MANUAL_OPERATION', 'source'),
    );
    await dialog.save();
    expect(dialog.errors.value).toEqual({ source: 'Укажите источник' });
    expect(dialog.open.value).toBe(true);

    api.createManual.mockResolvedValueOnce(VIEW);
    dialog.form.value = { ...dialog.form.value, source: 'Акт' };
    await dialog.save();
    expect(dialog.open.value).toBe(false);
    const [first, second] = api.createManual.mock.calls.map(([body]) => body.clientKey);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
    expect(api.createManual.mock.calls[1]?.[0]).toMatchObject({
      amount: '-100',
      source: 'Акт',
      sku: null,
    });

    // Новая форма — новый ключ.
    dialog.openCreate();
    expect(dialog.clientKey.value).not.toBe(first);
  });

  it('правка: форма из операции, сумма со знаком, без ключа формы', async () => {
    api.updateManual.mockResolvedValueOnce(VIEW);
    const dialog = useManualOperationDialog(() => '2026-11-08');
    dialog.openEdit(OP);
    expect(dialog.form.value).toMatchObject({ amount: '-1500,5', sku: 'A1', subArticle: '' });
    await dialog.save();
    const [id, body] = api.updateManual.mock.calls[0] ?? [];
    expect(id).toBe('m1');
    expect(body.clientKey).toBeUndefined();
  });
});

describe('useManualOperationRemoval', () => {
  it('удаление после подтверждения', async () => {
    api.removeManual.mockResolvedValueOnce(VIEW);
    const removal = useManualOperationRemoval();
    removal.ask(OP);
    expect(removal.open.value).toBe(true);
    await removal.confirm();
    expect(api.removeManual).toHaveBeenCalledWith('m1');
    expect(removal.open.value).toBe(false);
  });
});
