import { describe, expect, it } from 'vitest';

import { displayNameOf, mapMe } from './mapMe.auth';

const RESPONSE = {
  telegramUserId: '222',
  name: '  ',
  username: 'vasya',
  isAdmin: false,
  mustChangePassword: true,
  store: { name: 'Всё для часов', placementType: 'FBS' },
  features: { profit: false },
  sections: ['ym-dashboard', 'profile'],
};

describe('mapMe', () => {
  it('пустое имя — null, а не пустая строка на экране', () => {
    expect(mapMe(RESPONSE).name).toBeNull();
  });

  it('разделы навигации проходят как есть', () => {
    expect(mapMe(RESPONSE).sections).toEqual(['ym-dashboard', 'profile']);
  });

  it('подпись: имя, иначе @ник, иначе id', () => {
    expect(displayNameOf({ ...mapMe(RESPONSE), name: 'Вася' })).toBe('Вася');
    expect(displayNameOf(mapMe(RESPONSE))).toBe('@vasya');
    expect(displayNameOf({ ...mapMe(RESPONSE), username: null })).toBe('222');
  });
});
