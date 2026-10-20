import type { QuarantineView } from '../quarantine.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { useQuarantineStore } from '../store/store.quarantine';

import { useQuarantineActions } from './useQuarantineActions.quarantine';

const api = vi.hoisted(() => ({ list: vi.fn(), confirm: vi.fn() }));
vi.mock('../api/quarantineApi.quarantine', () => ({ quarantineApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast }));

const view = (ids: string[]): QuarantineView => ({
  explainer: [],
  note: '',
  rows: ids.map((offerId) => ({
    offerId,
    reasons: [],
    currentPrice: null,
    lastValidPrice: null,
    minPrice: null,
  })),
});

async function setup(ids: string[]) {
  const store = useQuarantineStore();
  api.list.mockResolvedValueOnce(view(ids));
  await store.load('k1');
  return useQuarantineActions(ref('k1'));
}

describe('useQuarantineActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.list.mockReset();
    api.confirm.mockReset();
    toast.success.mockReset();
  });

  it('отметки: одна, все, снятие', async () => {
    const actions = await setup(['A', 'B']);
    actions.toggle('A', true);
    expect(actions.allSelected.value).toBe(false);
    actions.toggleAll(true);
    expect(actions.allSelected.value).toBe(true);
    actions.toggleAll(false);
    expect(actions.selected.value.size).toBe(0);
  });

  it('без диалога ничего не пишется; «выбранные» шлют только отмеченные', async () => {
    const actions = await setup(['A', 'B', 'C']);
    actions.toggle('B', true);
    actions.ask({ kind: 'selected' });
    expect(actions.dialogOpen.value).toBe(true);
    expect(actions.targetCount.value).toBe(1);
    expect(api.confirm).not.toHaveBeenCalled();

    api.confirm.mockResolvedValueOnce({ confirmed: 1, stale: 0 });
    api.list.mockResolvedValueOnce(view(['A', 'C']));
    await actions.confirm();
    expect(api.confirm).toHaveBeenCalledWith('k1', ['B']);
    expect(actions.dialogOpen.value).toBe(false);
    expect(toast.success).toHaveBeenCalledOnce();

    await nextTick();
    // Ушедший из карантина снят с отметок.
    expect(actions.selected.value.has('B')).toBe(false);
  });

  it('«все» — весь список; пустой выбор диалог не открывает', async () => {
    const actions = await setup(['A', 'B']);
    actions.ask({ kind: 'selected' });
    expect(actions.dialogOpen.value).toBe(false);

    actions.ask({ kind: 'all' });
    api.confirm.mockResolvedValueOnce({ confirmed: 2, stale: 0 });
    api.list.mockResolvedValueOnce(view([]));
    await actions.confirm();
    expect(api.confirm).toHaveBeenCalledWith('k1', ['A', 'B']);
  });

  it('сбой — без тоста успеха, диалог закрыт', async () => {
    const actions = await setup(['A']);
    actions.ask({ kind: 'one', offerId: 'A' });
    api.confirm.mockRejectedValueOnce(new Error('Подтверждено 0'));
    api.list.mockResolvedValueOnce(view(['A']));
    await actions.confirm();
    expect(toast.success).not.toHaveBeenCalled();
    expect(actions.dialogOpen.value).toBe(false);
  });
});
