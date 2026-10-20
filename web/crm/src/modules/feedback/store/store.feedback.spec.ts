import type { FeedbackView } from '../feedback.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFeedbackStore } from './store.feedback';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({ list: vi.fn(), reply: vi.fn(), skip: vi.fn() }));
vi.mock('../api/feedbackApi.feedback', () => ({ feedbackApi: api }));

const feedbackView = (ids: number[]): FeedbackView => ({
  note: 'n',
  publicNote: 'p',
  productNote: 'pr',
  more: null,
  replyMaxLength: 10,
  rows: ids.map((feedbackId) => ({
    feedbackId,
    rating: null,
    stars: null,
    author: null,
    date: null,
    orderId: null,
    parts: [],
  })),
});

describe('store.feedback', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.list.mockReset();
    api.reply.mockReset();
    api.skip.mockReset();
  });

  it('загрузка по ключу магазина; ошибка — текстом сервера', async () => {
    const store = useFeedbackStore();
    api.list.mockResolvedValueOnce(feedbackView([1]));
    await store.load('k1');
    expect(api.list).toHaveBeenCalledWith('k1');
    expect(store.view?.rows).toHaveLength(1);

    api.list.mockRejectedValueOnce(new ApiError('Маркет не отвечает', 502, 'MARKET_ERROR'));
    await store.load('k1');
    expect(store.loadError).toBe('Маркет не отвечает');
  });

  it('ответ перезагружает список и при успехе, и при сбое', async () => {
    const store = useFeedbackStore();
    api.list.mockResolvedValue(feedbackView([]));
    api.reply.mockResolvedValueOnce(undefined);

    expect(await store.reply('k1', 1, 'Спасибо')).toEqual({ ok: true });
    expect(api.reply).toHaveBeenCalledWith('k1', 1, 'Спасибо');
    expect(api.list).toHaveBeenCalledTimes(1);

    api.reply.mockRejectedValueOnce(new ApiError('Маркет недоступен', 502, 'MARKET_ERROR'));
    expect(await store.reply('k1', 1, 'Спасибо')).toEqual({
      ok: false,
      message: 'Маркет недоступен',
      gone: false,
      field: null,
    });
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(store.isWriting).toBe(false);
  });

  it('409 FEEDBACK_GONE и 400 с полем различимы в итоге', async () => {
    const store = useFeedbackStore();
    api.list.mockResolvedValue(feedbackView([]));
    api.skip.mockRejectedValueOnce(new ApiError('Уже обработан', 409, 'FEEDBACK_GONE'));
    expect(await store.skip('k1', 1)).toMatchObject({ ok: false, gone: true });

    api.reply.mockRejectedValueOnce(new ApiError('Длинно', 400, 'INVALID_REPLY', 'text'));
    expect(await store.reply('k1', 1, 'x')).toMatchObject({ ok: false, field: 'text' });
  });

  it('reset чистит список и ошибку', async () => {
    const store = useFeedbackStore();
    api.list.mockResolvedValueOnce(feedbackView([1]));
    await store.load('k1');
    api.list.mockRejectedValueOnce(new Error('x'));
    await store.load('k1');

    store.reset();
    expect(store.view).toBeNull();
    expect(store.loadError).toBeNull();
    expect(store.isWriting).toBe(false);
  });
});
