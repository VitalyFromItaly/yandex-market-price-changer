import type { JournalMonth } from './financeJournal.domain';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import { PULL_POLL_MS, PULL_TIMEOUT_MS } from './financeJournal.domain';
import { PULL_TIMEOUT_TEXT, useFinanceJournal } from './useFinanceJournal';

const api = vi.hoisted(() => ({ months: vi.fn(), pull: vi.fn() }));
vi.mock('./financeJournalApi', () => ({ financeJournalApi: api }));

const auth = vi.hoisted(() => ({ me: null as { features: Record<string, boolean> } | null }));
vi.mock('@/modules/auth/store/store.auth', () => ({ useAuthStore: () => auth }));

vi.mock('@/shared/period', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  moscowTodayIso: () => '2026-10-20',
}));

const OCT_EMPTY: JournalMonth = { month: '2026-10', loaded: false, checkedAt: null, error: null };
const OCT_LOADED: JournalMonth = {
  month: '2026-10',
  loaded: true,
  checkedAt: '2026-10-20T15:01:00Z',
  error: null,
};

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await nextTick();
};

function mount(onLoaded = vi.fn()) {
  const scope = effectScope();
  const source = ref({ marketplace: 'ym' as const, from: '2026-10-14', to: '2026-10-20' });
  const journal = scope.run(() => useFinanceJournal(() => source.value, onLoaded));
  if (!journal) throw new Error('нет области');
  return { scope, source, journal, onLoaded };
}

beforeEach(() => {
  vi.useFakeTimers();
  api.months.mockReset();
  api.pull.mockReset();
  auth.me = { features: { finance: true, finance_pull: true } };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFinanceJournal', () => {
  it('без «Финансов» журнал не спрашивается и кнопки нет', async () => {
    auth.me = { features: {} };
    const { journal } = mount();
    await flush();
    expect(api.months).not.toHaveBeenCalled();
    expect(journal.coverage.value).toBeNull();
    expect(journal.canPull.value).toBe(false);
  });

  it('незагруженный месяц периода — missing; кнопка ставит его и ждёт смены checkedAt', async () => {
    api.months.mockResolvedValueOnce([OCT_EMPTY]);
    const { journal, onLoaded } = mount();
    await flush();
    expect(journal.missing.value).toEqual(['2026-10']);

    api.pull.mockResolvedValueOnce({ queued: ['2026-10'], cooldown: [] });
    api.months.mockResolvedValueOnce([OCT_EMPTY]).mockResolvedValueOnce([OCT_LOADED]);
    const done = journal.pull();
    await flush();
    expect(api.pull).toHaveBeenCalledWith('ym', ['2026-10']);
    expect(journal.pulling.value).toBe(true);

    await vi.advanceTimersByTimeAsync(PULL_POLL_MS);
    expect(onLoaded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PULL_POLL_MS);
    await done;
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(journal.pulling.value).toBe(false);
    expect(journal.missing.value).toEqual([]);
  });

  it('месяц в кулдауне — подпись, без опроса', async () => {
    api.months.mockResolvedValueOnce([OCT_EMPTY]);
    const { journal, onLoaded } = mount();
    await flush();
    api.pull.mockResolvedValueOnce({
      queued: [],
      cooldown: [{ month: '2026-10', checkedAt: '', until: '2026-10-20T12:15:00Z' }],
    });
    await journal.pull();
    expect(journal.notice.value).toContain('уже загружали');
    expect(journal.pulling.value).toBe(false);
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('Маркет долго — через 10 минут перестаём ждать и говорим об этом', async () => {
    api.months.mockResolvedValue([OCT_EMPTY]);
    const { journal } = mount();
    await flush();
    api.pull.mockResolvedValueOnce({ queued: ['2026-10'], cooldown: [] });
    const done = journal.pull();
    await vi.advanceTimersByTimeAsync(PULL_TIMEOUT_MS + PULL_POLL_MS);
    await done;
    expect(journal.notice.value).toBe(PULL_TIMEOUT_TEXT);
    expect(journal.pulling.value).toBe(false);
  });

  it('уход со страницы останавливает опрос', async () => {
    api.months.mockResolvedValue([OCT_EMPTY]);
    const { journal, scope, onLoaded } = mount();
    await flush();
    api.pull.mockResolvedValueOnce({ queued: ['2026-10'], cooldown: [] });
    const done = journal.pull();
    await flush();
    const calls = api.months.mock.calls.length;
    scope.stop();
    await vi.advanceTimersByTimeAsync(PULL_POLL_MS * 3);
    await done;
    expect(api.months.mock.calls.length).toBeLessThanOrEqual(calls + 1);
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('отказ сервера — текстом под кнопкой', async () => {
    api.months.mockResolvedValueOnce([OCT_EMPTY]);
    const { journal } = mount();
    await flush();
    api.pull.mockRejectedValueOnce(new Error('Журнал этой площадки не загружается'));
    await journal.pull();
    expect(journal.error.value).toBe('Журнал этой площадки не загружается');
    expect(journal.pulling.value).toBe(false);
  });
});
