import type { JobView } from '@/shared/jobs';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePriceListStore } from '../store.price-list';

import { FIRST_POLL_MS } from '@/shared/composables';
import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({
  upload: vi.fn(),
  purchasePrices: vi.fn(),
  applyStockPush: vi.fn(),
  jobGet: vi.fn(),
  jobStart: vi.fn(),
}));

vi.mock('../../api/priceListApi.price-list', () => ({
  priceListApi: {
    upload: api.upload,
    purchasePrices: api.purchasePrices,
    applyStockPush: api.applyStockPush,
  },
}));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.jobStart, get: api.jobGet, file: vi.fn() },
}));

const file = (name = 'прайс.xlsx', size = 10) => ({ name, size }) as File;

const done = (jobId: string): JobView => ({
  jobId,
  kind: 'price-list:upload',
  status: 'done',
  error: null,
  file: null,
  data: {
    headline: '✅ Остатки обновлены',
    explanation: null,
    advice: null,
    dryRun: false,
    writeSkipReason: null,
    placementType: 'FBS',
    totalRows: 2,
    catalogSize: 2,
    matched: 2,
    zeroed: 0,
    updated: 2,
    purchasePricesSaved: 2,
    purchasePricesSkipped: false,
    matchedBy: {},
    skipped: [],
    errors: [],
  },
});

describe('usePriceListStore: загрузка', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('файл не Excel — ошибка под полем, на сервер не уходит', async () => {
    const store = usePriceListStore();
    await store.upload(file('stock.csv'), false, 's1');

    expect(store.uploadErrors.file).toContain('stock.csv');
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('принят → предупреждение в состоянии → опрос → итог', async () => {
    api.upload.mockResolvedValue({ jobId: 'j1', warning: 'FBY', progress: '🔍', ahead: 0 });
    api.jobGet.mockResolvedValue(done('j1'));
    const store = usePriceListStore();

    await store.upload(file(), true, 's1');
    // Ключ магазина едет в запрос: остатки пишутся на склад открытого магазина.
    expect(api.upload).toHaveBeenCalledWith(expect.anything(), true, 's1');
    expect(store.uploadAccepted?.warning).toBe('FBY');
    expect(store.isProcessing).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.jobGet).toHaveBeenCalledWith('j1');
    expect(store.uploadResult?.success).toBe(true);
    expect(store.isProcessing).toBe(false);
  });

  it('прайс уже обрабатывается (409) — подхватываем идущую задачу', async () => {
    api.upload.mockRejectedValue(
      new ApiError('Предыдущий прайс ещё обрабатывается', 409, 'UPLOAD_RUNNING', null, {
        jobId: 'old',
      }),
    );
    api.jobGet.mockResolvedValue(done('old'));
    const store = usePriceListStore();

    await store.upload(file(), false, 's1');
    expect(store.uploadErrors.form).toContain('обрабатывается');

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.jobGet).toHaveBeenCalledWith('old');
  });

  it('reset гасит опрос и чистит состояние', async () => {
    api.upload.mockResolvedValue({ jobId: 'j1', warning: null, progress: '⏳', ahead: 0 });
    const store = usePriceListStore();
    await store.upload(file(), false, 's1');

    store.reset();
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS * 2);

    expect(api.jobGet).not.toHaveBeenCalled();
    expect(store.uploadAccepted).toBeNull();
  });
});

describe('usePriceListStore: закупочные цены', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.resetAllMocks());

  const page = (n: number) => ({
    items: [],
    total: 0,
    page: n,
    limit: 50,
    pages: 1,
    lastUpdated: null,
  });

  it('поиск начинает с первой страницы', async () => {
    api.purchasePrices.mockImplementation(async (q: { page: number }) => page(q.page));
    const store = usePriceListStore();

    await store.goToPricesPage(3);
    await store.searchPrices('  casio ');

    expect(api.purchasePrices).toHaveBeenLastCalledWith({ q: 'casio', page: 1 });
  });

  it('поздний ответ старого запроса не затирает новый', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    api.purchasePrices
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(page(2));
    const store = usePriceListStore();

    const first = store.loadPrices();
    await store.goToPricesPage(2);
    resolveFirst(page(1));
    await first;

    expect(store.prices?.page).toBe(2);
  });
});

describe('usePriceListStore: план записи остатков', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.jobStart.mockResolvedValue({ jobId: 'plan', created: true });
    api.jobGet.mockResolvedValue({
      jobId: 'plan',
      kind: 'stock-push:plan',
      status: 'running',
      error: null,
      file: null,
      data: null,
    });
  });
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('план — задача аккаунта; повторный вход не ставит вторую', () => {
    const store = usePriceListStore();
    store.ensurePlan();
    store.ensurePlan();
    expect(api.jobStart).toHaveBeenCalledTimes(1);
    expect(api.jobStart).toHaveBeenCalledWith('stock-push:plan', {}, '');
  });

  it('запись уходит с отпечатком плана и только отмеченными площадками', async () => {
    vi.useFakeTimers();
    api.jobGet.mockResolvedValue({
      jobId: 'plan',
      kind: 'stock-push:plan',
      status: 'done',
      error: null,
      file: null,
      data: { planHash: 'h'.repeat(64), targets: [] },
    });
    api.applyStockPush.mockResolvedValue({ jobId: 'w' });
    const store = usePriceListStore();
    store.ensurePlan();
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.plan?.planHash).toBe('h'.repeat(64));

    await store.applyPlan([]);
    expect(api.applyStockPush).not.toHaveBeenCalled();
    await store.applyPlan(['ozon']);
    expect(api.applyStockPush).toHaveBeenCalledWith('h'.repeat(64), ['ozon']);
    vi.useRealTimers();
  });

  it('без плана или без площадок записывать нечего — запрос не уходит', async () => {
    const store = usePriceListStore();
    await store.applyPlan(['ym']);
    expect(api.applyStockPush).not.toHaveBeenCalled();
    expect(store.isWriting).toBe(false);
  });
});
