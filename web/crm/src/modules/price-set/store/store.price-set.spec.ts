import type { JobView } from '@/shared/jobs';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePriceSetStore } from './store.price-set';

import { FIRST_POLL_MS } from '@/shared/composables';
import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({
  upload: vi.fn(),
  apply: vi.fn(),
  purchasePrices: vi.fn(),
  jobGet: vi.fn(),
  jobStart: vi.fn(),
}));

vi.mock('../api/priceSetApi.price-set', () => ({
  priceSetApi: { upload: api.upload, apply: api.apply },
}));
vi.mock('@/modules/price-list/api/priceListApi.price-list', () => ({
  priceListApi: { purchasePrices: api.purchasePrices },
}));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.jobStart, get: api.jobGet, file: vi.fn() },
}));

const PLAN_ID = '11111111-1111-1111-1111-111111111111';
const HASH = 'h'.repeat(64);

const donePlan = (jobId = PLAN_ID): JobView => ({
  jobId,
  kind: 'price-set:plan',
  status: 'done',
  error: null,
  file: null,
  data: { planHash: HASH, source: 'markup', targets: [] },
});

const file = (name = 'цены.csv', size = 10) => ({ name, size }) as File;

describe('usePriceSetStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('наценка — задача плана уровня аккаунта с процентами', async () => {
    api.jobStart.mockResolvedValue({ jobId: PLAN_ID, created: true });
    api.jobGet.mockResolvedValue(donePlan());
    const store = usePriceSetStore();

    await store.planByMarkup({ ym: 250, wb: 300 });
    expect(api.jobStart).toHaveBeenCalledWith(
      'price-set:plan',
      { markups: { ym: 250, wb: 300 } },
      '',
    );
    expect(store.planLoading).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.plan?.planHash).toBe(HASH);
    expect(store.planLoading).toBe(false);
  });

  it('файл уходит с площадками; неподходящий файл — ошибка под полем без запроса', async () => {
    const store = usePriceSetStore();
    await store.planByFile(file('цены.pdf'), ['ym']);
    expect(store.planErrors.file).toContain('цены.pdf');
    expect(api.upload).not.toHaveBeenCalled();

    api.upload.mockResolvedValue({ jobId: PLAN_ID, created: true });
    api.jobGet.mockResolvedValue(donePlan());
    await store.planByFile(file(), ['ym', 'wb']);
    expect(api.upload).toHaveBeenCalledWith(expect.anything(), ['ym', 'wb']);
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.jobGet).toHaveBeenCalledWith(PLAN_ID);
  });

  it('план уже считается (409) — подхватываем идущий', async () => {
    api.upload.mockRejectedValue(
      new ApiError('План цен уже считается', 409, 'PLAN_RUNNING', null, { jobId: 'old' }),
    );
    api.jobGet.mockResolvedValue(donePlan('old'));
    const store = usePriceSetStore();

    await store.planByFile(file(), ['ym']);
    expect(store.planErrors.form).toContain('считается');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.jobGet).toHaveBeenCalledWith('old');
  });

  it('запись уходит с id плана, отпечатком, площадками и снятыми строками', async () => {
    api.jobStart.mockResolvedValue({ jobId: PLAN_ID, created: true });
    api.jobGet.mockResolvedValue(donePlan());
    api.apply.mockResolvedValue({ jobId: 'w' });
    const store = usePriceSetStore();
    await store.planByMarkup({ ym: 250 });
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    await store.apply([], []);
    expect(api.apply).not.toHaveBeenCalled();
    await store.apply(['ym'], ['ym:b']);
    expect(api.apply).toHaveBeenCalledWith({
      planJobId: PLAN_ID,
      planHash: HASH,
      marketplaces: ['ym'],
      excluded: ['ym:b'],
    });
  });

  it('без плана записывать нечего; запись уже идёт (409) — текст и опрос той задачи', async () => {
    const store = usePriceSetStore();
    await store.apply(['ym'], []);
    expect(api.apply).not.toHaveBeenCalled();

    api.jobStart.mockResolvedValue({ jobId: PLAN_ID, created: true });
    api.jobGet.mockResolvedValue(donePlan());
    await store.planByMarkup({ ym: 250 });
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    api.apply.mockRejectedValue(
      new ApiError('Запись цен уже идёт', 409, 'PRICE_SET_RUNNING', null, { jobId: 'w0' }),
    );
    api.jobGet.mockResolvedValue({
      jobId: 'w0',
      kind: 'price-set:apply',
      status: 'done',
      error: null,
      file: null,
      data: { writes: [] },
    });
    await store.apply(['ym'], []);
    expect(store.applyError).toContain('уже идёт');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.jobGet).toHaveBeenLastCalledWith('w0');
    expect(store.writeResult).not.toBeNull();
  });

  it('reset гасит опрос и чистит план', async () => {
    api.jobStart.mockResolvedValue({ jobId: PLAN_ID, created: true });
    const store = usePriceSetStore();
    await store.planByMarkup({ ym: 250 });

    store.reset();
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS * 2);

    expect(api.jobGet).not.toHaveBeenCalled();
    expect(store.hasPlanRequest).toBe(false);
  });
});
