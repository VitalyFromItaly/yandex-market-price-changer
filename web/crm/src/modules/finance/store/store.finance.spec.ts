import type { FinanceMonth } from '../finance.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useFinanceStore } from './store.finance';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({
  months: vi.fn(),
  operations: vi.fn(),
  original: vi.fn(),
  cashflow: vi.fn(),
  discrepancies: vi.fn(),
  corrections: vi.fn(),
  anomalies: vi.fn(),
}));
vi.mock('../api/financeApi.finance', () => ({ financeApi: api }));
// Раскрытие статьи переехало в shared (общее с «ИИ-аналитиком») — тот же стаб.
vi.mock('@/shared/finance-operations/financeOperationsApi', () => ({
  financeOperationsApi: { operations: api.operations, original: api.original },
}));

const jobs = vi.hoisted(() => ({ start: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: jobs.start, get: vi.fn(), file: vi.fn() },
  saveFile: jobs.saveFile,
}));

const month = (value: string): FinanceMonth => ({
  month: value,
  from: `${value}-01`,
  to: `${value}-28`,
  status: null,
  statusLabel: 'Журнал не загружен',
  discrepancyCount: 0,
  changedCount: 0,
  removedCount: 0,
  unknownCount: 0,
  reconcileNote: null,
  checkedAt: null,
});

const operation = (id: string) => ({
  id,
  article: 'sales',
  articleTitle: 'Продажи',
  amountKopecks: 100,
  orderId: null,
  sku: null,
  count: null,
  serviceName: null,
  transactionType: 'Начисление',
  transactionSource: null,
  accruedAt: '2026-09-16T11:05:00.000Z',
  paidAt: null,
  actDate: null,
  bankOrderId: null,
  documentId: 'doc',
});

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(jobs)]) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Финансы»', () => {
  it('месяцы: по умолчанию текущий (первый), выбранный переживает перечитывание', async () => {
    const store = useFinanceStore();
    api.months.mockResolvedValue([month('2026-10'), month('2026-09')]);
    await store.loadMonths();
    expect(store.selectedMonth).toBe('2026-10');
    store.selectMonth('2026-09');
    await store.loadMonths();
    expect(store.selectedMonth).toBe('2026-09');
    expect(store.currentMonth?.month).toBe('2026-09');
  });

  it('P&L — задача аккаунта: kind finance:pnl, месяц в params, без магазина', async () => {
    const store = useFinanceStore();
    jobs.start.mockResolvedValue({ jobId: 'j1', created: true });
    await store.loadPnl({ month: '2026-09' });
    expect(jobs.start).toHaveBeenCalledWith('finance:pnl', { month: '2026-09' }, '');
  });

  it('площадка P&L (TASK-137): едет в params задачи', async () => {
    const store = useFinanceStore();
    await store.loadPnl({ month: '2026-09', marketplace: 'ozon' });
    expect(jobs.start).toHaveBeenCalledWith(
      'finance:pnl',
      { month: '2026-09', marketplace: 'ozon' },
      '',
    );
  });

  it('площадка экрана (TASK-180): уходит в каждый запрос; смена сбрасывает данные прежней', async () => {
    const store = useFinanceStore();
    expect(store.marketplace).toBe('ym');
    api.months.mockResolvedValue([month('2026-09')]);
    api.corrections.mockResolvedValue({ total: 0, items: [] });
    api.discrepancies.mockResolvedValue({ total: 0, items: [] });
    await store.loadMonths();
    expect(api.months).toHaveBeenLastCalledWith('ym');

    store.selectMarketplace('ozon');
    expect(store.months).toEqual([]);
    expect(store.selectedMonth).toBeNull();
    await store.loadMonths();
    expect(api.months).toHaveBeenLastCalledWith('ozon');
    await store.loadAudit('2026-09');
    expect(api.discrepancies).toHaveBeenLastCalledWith('ozon', '2026-09', 0, 50);
    expect(api.corrections).toHaveBeenLastCalledWith('ozon', '2026-09', 0, 50);

    store.reset();
    expect(store.marketplace).toBe('ym');
  });

  it('вкладки, которой у площадки нет, — причина вместо данных (TASK-180)', async () => {
    const store = useFinanceStore();
    store.selectMarketplace('wb');
    const note = (text: string) => ({ unsupported: true, note: text });
    api.cashflow.mockResolvedValue(note('Нет данных о выплатах'));
    api.discrepancies.mockResolvedValue(note('Сверки нет'));
    api.corrections.mockResolvedValue({ total: 0, items: [] });
    api.anomalies.mockResolvedValue(note('Аномалий нет'));

    await store.loadCashflow('2026-09');
    expect(store.cashflow).toBeNull();
    expect(store.cashflowNote).toBe('Нет данных о выплатах');
    await store.loadAudit('2026-09');
    expect(store.discrepancies).toBeNull();
    expect(store.discrepanciesNote).toBe('Сверки нет');
    expect(store.corrections).toEqual({ total: 0, items: [] });
    await store.loadAnomalies('2026-09');
    expect(store.anomalies).toBeNull();
    expect(store.anomaliesNote).toBe('Аномалий нет');
    expect(api.anomalies).toHaveBeenLastCalledWith('wb', '2026-09', 0, expect.any(Number), true);
  });

  it('период из ссылки «Обзора»: from/to в params; выбор месяца его снимает', async () => {
    const store = useFinanceStore();
    jobs.start.mockResolvedValue({ jobId: 'j1', created: true });
    await store.loadPnl({ from: '2026-09-14', to: '2026-09-20' });
    expect(jobs.start).toHaveBeenCalledWith(
      'finance:pnl',
      { from: '2026-09-14', to: '2026-09-20' },
      '',
    );

    store.selectRange({ from: '2026-09-14', to: '2026-09-20' });
    expect(store.selectedMonth).toBe('2026-09');
    store.selectMonth('2026-10');
    expect(store.selectedRange).toBeNull();
  });

  it('раскрытие статьи листает её id страницами по 50; поздний ответ отбрасывается', async () => {
    const store = useFinanceStore();
    const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);
    api.operations.mockImplementation(async (page: string[]) => page.map(operation));
    await store.openArticle({ title: 'Продажи', amount: '1 ₽', operationIds: ids });
    expect(api.operations).toHaveBeenLastCalledWith(ids.slice(0, 50));
    expect(store.operationsPages).toBe(3);
    expect(store.operations).toHaveLength(50);

    await store.loadOperationsPage(3);
    expect(api.operations).toHaveBeenLastCalledWith(ids.slice(100, 120));
    expect(store.operations).toHaveLength(20);

    let release: (v: unknown) => void = () => undefined;
    api.operations.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const slow = store.loadOperationsPage(1);
    store.closeArticle();
    release([operation('late')]);
    await slow;
    expect(store.article).toBeNull();
    expect(store.operations).toEqual([]);
  });

  it('оригинал скачивается файлом; сбой — текстом, без исключения', async () => {
    const store = useFinanceStore();
    const file = { blob: new Blob(['zip']), filename: 'netting.zip' };
    api.original.mockResolvedValueOnce(file);
    await store.downloadOriginal('doc');
    expect(jobs.saveFile).toHaveBeenCalledWith(file, 'united-netting.zip');

    api.original.mockRejectedValueOnce(new Error('Оригинал отчёта не найден'));
    await store.downloadOriginal('doc');
    expect(store.downloadError).toBe('Оригинал отчёта не найден');
  });

  it('ДДС и сверка — за выбранный месяц; ответ прежнего месяца не показывается', async () => {
    const store = useFinanceStore();
    let release: (v: unknown) => void = () => undefined;
    api.cashflow.mockImplementationOnce(() => new Promise((r) => (release = r)));
    api.cashflow.mockResolvedValueOnce({ from: '2026-10-01' });
    const old = store.loadCashflow('2026-09');
    await store.loadCashflow('2026-10');
    release({ from: '2026-09-01' });
    await old;
    expect(store.cashflow).toEqual({ from: '2026-10-01' });

    api.discrepancies.mockResolvedValue({ total: 0, items: [] });
    api.corrections.mockResolvedValue({ total: 0, items: [] });
    await store.loadAudit('2026-09');
    expect(api.discrepancies).toHaveBeenCalledWith('ym', '2026-09', 0, 50);
    expect(api.corrections).toHaveBeenCalledWith('ym', '2026-09', 0, 50);
    expect(store.discrepancies).toEqual({ total: 0, items: [] });
  });

  it('resetAllStores чистит всё', async () => {
    const store = useFinanceStore();
    api.months.mockResolvedValue([month('2026-10')]);
    await store.loadMonths();
    resetAllStores();
    expect(store.months).toEqual([]);
    expect(store.selectedMonth).toBeNull();
    expect(store.article).toBeNull();
  });
});
