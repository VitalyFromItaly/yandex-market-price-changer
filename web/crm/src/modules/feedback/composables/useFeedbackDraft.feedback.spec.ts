import type { FeedbackView } from '../feedback.domain';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useFeedbackStore } from '../store/store.feedback';

import { useFeedbackDraft } from './useFeedbackDraft.feedback';
import { useFeedbackReply } from './useFeedbackReply.feedback';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  reply: vi.fn(),
  skip: vi.fn(),
  draftStart: vi.fn(),
  draftTurn: vi.fn(),
}));
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
  const key = ref('k1');
  const reply = useFeedbackReply(key);
  return { reply, draft: useFeedbackDraft(key, reply) };
}

/** Ход завершается на первом опросе — прокручиваем таймер опроса. */
async function finish(promise: Promise<void>) {
  await vi.advanceTimersByTimeAsync(1_000);
  await promise;
}

describe('useFeedbackDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    Object.values(api).forEach((fn) => fn.mockReset());
    toast.info.mockReset();
    api.draftStart.mockResolvedValue('t1');
  });
  afterEach(() => vi.useRealTimers());

  it('черновик ложится в поле открытого отзыва; публикации нет, шаг — правка', async () => {
    const { reply, draft } = await setup([1]);
    reply.open(1);
    api.draftTurn.mockResolvedValue({
      status: 'done',
      answer: { text: 'Спасибо!', gone: false, message: null },
    });

    await finish(draft.suggest());

    expect(api.draftStart).toHaveBeenCalledWith('k1', 1);
    expect(reply.text.value).toBe('Спасибо!');
    expect(reply.step.value).toBe('edit');
    expect(reply.error.value).toBeNull();
    expect(draft.suggesting.value).toBe(false);
    expect(api.reply).not.toHaveBeenCalled();
  });

  it('длинный черновик не обрезается: текст в поле, причина — ошибкой', async () => {
    const { reply, draft } = await setup([1]);
    reply.open(1);
    const long = 'x'.repeat(20);
    api.draftTurn.mockResolvedValue({
      status: 'done',
      answer: { text: long, gone: false, message: 'Черновик длиннее 10 символов' },
    });

    await finish(draft.suggest());

    expect(reply.text.value).toBe(long);
    expect(reply.error.value).toContain('длиннее');
  });

  it('отзыв уже обработан — диалог закрыт, toast', async () => {
    const { reply, draft } = await setup([1]);
    reply.open(1);
    api.draftTurn.mockResolvedValue({
      status: 'done',
      answer: { text: '', gone: true, message: 'Отзыв уже обработан — список обновлён.' },
    });

    await finish(draft.suggest());

    expect(reply.dialogOpen.value).toBe(false);
    expect(toast.info).toHaveBeenCalled();
  });

  it('отказ ИИ — его текст ошибкой, поле не тронуто', async () => {
    const { reply, draft } = await setup([1]);
    reply.open(1);
    reply.text.value = 'моё';
    api.draftTurn.mockResolvedValue({ status: 'failed', message: 'Дневной лимит ИИ исчерпан' });

    await finish(draft.suggest());

    expect(reply.text.value).toBe('моё');
    expect(reply.error.value).toBe('Дневной лимит ИИ исчерпан');
  });

  it('переключили отзыв, пока ИИ думал — поздний черновик не ложится', async () => {
    const { reply, draft } = await setup([1, 2]);
    reply.open(1);
    api.draftTurn.mockResolvedValue({
      status: 'done',
      answer: { text: 'Спасибо!', gone: false, message: null },
    });

    const pending = draft.suggest();
    reply.open(2);
    await finish(pending);

    expect(reply.text.value).toBe('');
    reply.open(1);
    expect(reply.text.value).toBe('');
  });
});
