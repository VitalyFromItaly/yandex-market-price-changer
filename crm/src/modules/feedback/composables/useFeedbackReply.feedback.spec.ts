import type { FeedbackView } from '../feedback.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { useFeedbackStore } from '../store/store.feedback';

import { replyTextError, useFeedbackReply } from './useFeedbackReply.feedback';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({ list: vi.fn(), reply: vi.fn(), skip: vi.fn() }));
vi.mock('../api/feedbackApi.feedback', () => ({ feedbackApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast }));

const view = (ids: number[]): FeedbackView => ({
  note: '',
  publicNote: '',
  productNote: '',
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

async function setup(ids: number[]) {
  const store = useFeedbackStore();
  api.list.mockResolvedValueOnce(view(ids));
  await store.load('k1');
  return useFeedbackReply(ref('k1'));
}

describe('useFeedbackReply', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.list.mockReset();
    api.reply.mockReset();
    toast.success.mockReset();
    toast.info.mockReset();
  });

  it('replyTextError: пусто и длиннее лимита', () => {
    expect(replyTextError('  ', 10)).toContain('Напишите');
    expect(replyTextError('x'.repeat(12), 10)).toContain('на 2');
    expect(replyTextError('x'.repeat(10), 10)).toBeNull();
  });

  it('публикация только из превью; невалидный текст до превью не пускает', async () => {
    const reply = await setup([1]);
    reply.open(1);
    await reply.publish();
    expect(api.reply).not.toHaveBeenCalled();

    reply.text.value = 'x'.repeat(11);
    reply.preview();
    expect(reply.step.value).toBe('edit');
    expect(reply.error.value).toContain('сократите');
    expect(api.reply).not.toHaveBeenCalled();
  });

  it('успех: публикует ровно текст превью, закрывает диалог и снимает черновик', async () => {
    const reply = await setup([1, 2]);
    reply.open(1);
    reply.text.value = 'Спасибо';
    reply.preview();
    expect(reply.step.value).toBe('preview');

    api.reply.mockResolvedValueOnce(undefined);
    api.list.mockResolvedValueOnce(view([2]));
    await reply.publish();
    expect(api.reply).toHaveBeenCalledWith('k1', 1, 'Спасибо');
    expect(reply.dialogOpen.value).toBe(false);
    expect(reply.hasDraft(1)).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it('сбой Маркета: диалог и текст остаются, ошибка показана', async () => {
    const reply = await setup([1]);
    reply.open(1);
    reply.text.value = 'Спасибо';
    reply.preview();

    api.reply.mockRejectedValueOnce(new ApiError('Маркет недоступен', 502, 'MARKET_ERROR'));
    api.list.mockResolvedValueOnce(view([1]));
    await reply.publish();
    expect(reply.dialogOpen.value).toBe(true);
    expect(reply.text.value).toBe('Спасибо');
    expect(reply.error.value).toBe('Маркет недоступен');
    expect(reply.step.value).toBe('preview');
  });

  it('закрытый диалог хранит черновик; ушедший отзыв его теряет', async () => {
    const reply = await setup([1, 2]);
    reply.open(1);
    reply.text.value = 'Черновик';
    reply.dialogOpen.value = false;
    expect(reply.hasDraft(1)).toBe(true);

    reply.open(1);
    expect(reply.text.value).toBe('Черновик');

    api.list.mockResolvedValueOnce(view([2]));
    await useFeedbackStore().load('k1');
    await nextTick();
    expect(reply.hasDraft(1)).toBe(false);
    expect(reply.dialogOpen.value).toBe(false);
  });

  it('409: отзыв уже обработан — диалог закрыт, сказано почему', async () => {
    const reply = await setup([1]);
    reply.open(1);
    reply.text.value = 'Спасибо';
    reply.preview();
    api.reply.mockRejectedValueOnce(new ApiError('Уже обработан', 409, 'FEEDBACK_GONE'));
    api.list.mockResolvedValueOnce(view([]));
    await reply.publish();
    expect(reply.dialogOpen.value).toBe(false);
    expect(toast.info).toHaveBeenCalledWith('Отзыв уже обработан', 'Уже обработан');
  });
});
