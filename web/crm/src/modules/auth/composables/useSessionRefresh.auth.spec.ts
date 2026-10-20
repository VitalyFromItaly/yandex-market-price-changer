import { describe, expect, it } from 'vitest';

import { SESSION_REFRESH_INTERVAL_MS, shouldRefreshSession } from './useSessionRefresh.auth';

describe('shouldRefreshSession', () => {
  it('не чаще раза в интервал', () => {
    expect(shouldRefreshSession(1_000, 1_000 + SESSION_REFRESH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldRefreshSession(1_000, 1_000 + SESSION_REFRESH_INTERVAL_MS)).toBe(true);
  });

  it('профиль ещё не грузили — перечитать сразу', () => {
    expect(shouldRefreshSession(0, Date.now())).toBe(true);
  });
});
