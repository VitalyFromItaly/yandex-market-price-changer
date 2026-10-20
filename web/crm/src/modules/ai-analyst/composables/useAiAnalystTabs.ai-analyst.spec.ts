import { describe, expect, it } from 'vitest';

import { openAiAnalystTabs } from './useAiAnalystTabs.ai-analyst';

describe('вкладки «ИИ-аналитика» (TASK-150)', () => {
  it('открыты только вкладки с открытой фичей', () => {
    expect(openAiAnalystTabs({ ai_analyst: true }).map((t) => t.key)).toEqual(['chat']);
    expect(openAiAnalystTabs({ ai_period_review: true }).map((t) => t.key)).toEqual(['review']);
    expect(
      openAiAnalystTabs({ ai_analyst: true, ai_period_review: true }).map((t) => t.key),
    ).toEqual(['chat', 'review']);
    expect(openAiAnalystTabs(undefined)).toEqual([]);
  });
});
