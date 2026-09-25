import { describe, expect, it } from 'vitest';

import { PROFILE_TAB, PROFILE_TABS } from '../profile.domain';

import { resolveTab } from '@/shared/composables';

describe('вкладки «Профиля»', () => {
  it('без параметра — профиль, старый /profile/security — безопасность', () => {
    expect(resolveTab(undefined, PROFILE_TABS)?.key).toBe(PROFILE_TAB.INFO);
    expect(resolveTab('security', PROFILE_TABS)?.key).toBe(PROFILE_TAB.SECURITY);
  });

  it('неизвестная вкладка — первая, а не пустой экран', () => {
    expect(resolveTab('nope', PROFILE_TABS)?.key).toBe(PROFILE_TAB.INFO);
  });
});
