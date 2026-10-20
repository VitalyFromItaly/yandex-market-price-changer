import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAnalystStore } from './store.ai-analyst';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({ start: vi.fn(), turn: vi.fn(), rate: vi.fn() }));
vi.mock('../api/aiAnalystApi.ai-analyst', () => ({ aiAnalystApi: api }));

const ANSWER = {
  answer: 'Выручка 1000.00 ₽',
  verification: { verified: true, unconfirmed: [] },
  sources: [],
  gaps: ['По площадке Wildberries финансового журнала нет'],
  rounds: 2,
};

describe('стор ИИ-аналитика', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    api.start.mockReset().mockResolvedValue('t1');
    api.turn.mockReset();
    api.rate.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('вопрос → опрос → ответ в ленте; история уходит серверу', async () => {
    api.turn
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'done', answer: ANSWER });
    const store = useAiAnalystStore();
    const sent = store.send('Где заработал больше?');
    expect(store.pending).toBe(true);
    await vi.runAllTimersAsync();
    await sent;
    expect(api.start).toHaveBeenCalledWith([{ role: 'user', content: 'Где заработал больше?' }]);
    expect(store.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(store.messages[1]?.answer?.gaps).toHaveLength(1);
    expect(store.pending).toBe(false);
  });

  it('отказ (лимит) — текст сервера, вопрос возвращается в поле ввода', async () => {
    api.turn.mockResolvedValueOnce({ status: 'failed', message: 'Дневной лимит исчерпан' });
    const store = useAiAnalystStore();
    const sent = store.send('Вопрос');
    await vi.runAllTimersAsync();
    await sent;
    expect(store.error).toBe('Дневной лимит исчерпан');
    expect(store.messages).toEqual([]);
    expect(store.draft).toBe('Вопрос');
  });

  it('409 — ход уже идёт: опрашивается он', async () => {
    api.start.mockRejectedValueOnce(
      new ApiError('идёт', 409, 'TURN_RUNNING', null, { turnId: 'busy' }),
    );
    api.turn.mockResolvedValueOnce({ status: 'done', answer: ANSWER });
    const store = useAiAnalystStore();
    const sent = store.send('Вопрос');
    await vi.runAllTimersAsync();
    await sent;
    expect(api.turn).toHaveBeenCalledWith('busy');
    expect(store.messages).toHaveLength(2);
  });

  it('404 при опросе — ход потерян, честный текст', async () => {
    api.turn.mockRejectedValueOnce(new ApiError('нет', 404, 'TURN_NOT_FOUND'));
    const store = useAiAnalystStore();
    const sent = store.send('Вопрос');
    await vi.runAllTimersAsync();
    await sent;
    expect(store.error).toContain('потерялся');
  });

  it('reset во время хода: поздний ответ не попадает в ленту', async () => {
    api.turn.mockResolvedValueOnce({ status: 'done', answer: ANSWER });
    const store = useAiAnalystStore();
    const sent = store.send('Вопрос');
    store.reset();
    await vi.runAllTimersAsync();
    await sent;
    expect(store.messages).toEqual([]);
  });

  it('👍/👎: оценка по id хода, повтор заменяет, отказ сервера — прежняя оценка (TASK-170)', async () => {
    api.turn.mockResolvedValueOnce({ status: 'done', answer: ANSWER });
    const store = useAiAnalystStore();
    const sent = store.send('Вопрос');
    await vi.runAllTimersAsync();
    await sent;
    expect(store.messages[1]).toMatchObject({ turnId: 't1', rating: null });
    const id = store.messages[1]?.id ?? 0;

    await store.rate(id, 'up');
    expect(api.rate).toHaveBeenLastCalledWith('t1', 'up');
    await store.rate(id, 'down');
    expect(api.rate).toHaveBeenLastCalledWith('t1', 'down');
    expect(store.messages[1]?.rating).toBe('down');
    // Та же оценка ещё раз — запроса нет.
    await store.rate(id, 'down');
    expect(api.rate).toHaveBeenCalledTimes(2);

    api.rate.mockRejectedValueOnce(new ApiError('нет', 404, 'TURN_NOT_FOUND'));
    await store.rate(id, 'up');
    expect(store.messages[1]?.rating).toBe('down');
    expect(store.error).toContain('оценку');
  });
});
