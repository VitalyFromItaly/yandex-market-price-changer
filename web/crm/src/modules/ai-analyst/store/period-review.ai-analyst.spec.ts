import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAnalystStore } from './store.ai-analyst';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({ start: vi.fn(), turn: vi.fn(), rate: vi.fn() }));
vi.mock('../api/periodReviewApi.ai-analyst', () => ({ periodReviewApi: api }));

const SOURCE = {
  source: 'finance:sku',
  label: 'R1: Экономика товара «B1»',
  period: { from: '2026-09-01', to: '2026-09-30' },
  operationIds: ['op1'],
  operationCount: 1,
  documentIds: [],
};

const REVIEW = {
  month: '2026-09',
  previousMonth: '2026-08',
  answer: 'Выручка выросла. Поднимите цену [R1].',
  verification: { verified: true, unconfirmed: [] },
  recommendations: [
    {
      id: 'R1',
      kind: 'below_min_price',
      sku: 'B1',
      name: 'Часы',
      avgPriceKopecks: 300_000,
      minPriceKopecks: 425_532,
      netKopecks: -118_000,
      units: 1,
      schemes: ['FBS'],
      text: 'Средняя цена ниже минимальной',
      source: SOURCE,
    },
  ],
  sources: [SOURCE],
  gaps: [],
};

describe('стор ИИ-аналитика: разбор периода (TASK-150)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T09:00:00Z'));
    api.start.mockReset().mockResolvedValue('r1');
    api.turn.mockReset();
    api.rate.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('по умолчанию — прошлый месяц; разбор → карточки рекомендаций со ссылками', async () => {
    api.turn
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'done', answer: REVIEW });
    const store = useAiAnalystStore();
    expect(store.reviewMonth).toBe('2026-09');
    const run = store.runReview();
    expect(store.reviewPending).toBe(true);
    await vi.runAllTimersAsync();
    await run;
    expect(api.start).toHaveBeenCalledWith('2026-09');
    expect(store.review?.title).toBe('Сентябрь 2026 · к Август 2026');
    expect(store.review?.recommendations[0]).toMatchObject({ id: 'R1', title: 'Часы · B1' });
    expect(store.review?.recommendations[0]?.source.operations?.operationIds).toEqual(['op1']);
    expect(store.reviewPending).toBe(false);
  });

  it('журнала нет — пробелы без текста', async () => {
    api.turn.mockResolvedValueOnce({
      status: 'done',
      answer: {
        ...REVIEW,
        answer: null,
        recommendations: [],
        sources: [],
        gaps: ['Журнал не загружен'],
      },
    });
    const store = useAiAnalystStore();
    const run = store.runReview();
    await vi.runAllTimersAsync();
    await run;
    expect(store.review?.answer).toBeNull();
    expect(store.review?.gaps).toEqual(['Журнал не загружен']);
  });

  it('отказ сервера — его текст; 409 — подхватывается идущий разбор', async () => {
    api.start.mockRejectedValueOnce(
      new ApiError('идёт', 409, 'TURN_RUNNING', null, { turnId: 'busy' }),
    );
    api.turn.mockResolvedValueOnce({ status: 'failed', message: 'Дневной лимит исчерпан' });
    const store = useAiAnalystStore();
    const run = store.runReview();
    await vi.runAllTimersAsync();
    await run;
    expect(api.turn).toHaveBeenCalledWith('busy');
    expect(store.reviewError).toBe('Дневной лимит исчерпан');
  });

  it('смена месяца сбрасывает прошлый разбор; reset — к умолчанию', async () => {
    api.turn.mockResolvedValueOnce({ status: 'done', answer: REVIEW });
    const store = useAiAnalystStore();
    const run = store.runReview();
    await vi.runAllTimersAsync();
    await run;
    store.selectReviewMonth('2026-08');
    expect(store.review).toBeNull();
    expect(store.reviewMonth).toBe('2026-08');
    store.reset();
    expect(store.reviewMonth).toBe('2026-09');
  });

  it('👍/👎 разбора: по id хода, новый разбор сбрасывает оценку (TASK-170)', async () => {
    api.turn.mockResolvedValue({ status: 'done', answer: REVIEW });
    const store = useAiAnalystStore();
    let run = store.runReview();
    await vi.runAllTimersAsync();
    await run;
    expect(store.reviewRating).toBeNull();
    await store.rateReview('down');
    expect(api.rate).toHaveBeenCalledWith('r1', 'down');
    expect(store.reviewRating).toBe('down');

    run = store.runReview();
    await vi.runAllTimersAsync();
    await run;
    expect(store.reviewRating).toBeNull();
  });
});
