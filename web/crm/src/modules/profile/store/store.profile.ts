import { defineStore } from 'pinia';

import { useProfile } from './composables/useProfile.profile';

/** Стор раздела «Профиль» — тонкий фасад над слайсом. */
export const useProfileStore = defineStore('profile', () => {
  const profile = useProfile();
  return {
    ...profile,
    reset() {
      profile.reset();
    },
  };
});
