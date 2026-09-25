import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useFeedbackSkip } from './useFeedbackSkip.feedback';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({ list: vi.fn(), reply: vi.fn(), skip: vi.fn() }));
vi.mock('../api/feedbackApi.feedback', () => ({ feedbackApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast }));

describe('useFeedbackSkip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.list.mockReset().mockRejectedValue(new Error('не важно'));
    api.skip.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it('пропуск только после подтверждения диалога', async () => {
    const skip = useFeedbackSkip(ref('k1'));
    skip.ask(7);
    expect(skip.dialogOpen.value).toBe(true);
    expect(api.skip).not.toHaveBeenCalled();

    api.skip.mockResolvedValueOnce(undefined);
    await skip.confirm();
    expect(api.skip).toHaveBeenCalledWith('k1', 7);
    expect(skip.dialogOpen.value).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it('отмена — без записи; сбой — текстом Маркета', async () => {
    const skip = useFeedbackSkip(ref('k1'));
    skip.ask(7);
    skip.dialogOpen.value = false;
    await skip.confirm();
    expect(api.skip).not.toHaveBeenCalled();

    skip.ask(7);
    api.skip.mockRejectedValueOnce(new ApiError('Маркет недоступен', 502, 'MARKET_ERROR'));
    await skip.confirm();
    expect(toast.error).toHaveBeenCalledWith('Не удалось пропустить отзыв', 'Маркет недоступен');
  });
});
