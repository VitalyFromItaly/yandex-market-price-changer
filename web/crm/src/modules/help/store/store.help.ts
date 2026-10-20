import { defineStore } from 'pinia';

import { useHelp } from './composables/useHelp.help';

/** Стор раздела «Помощь» — тонкий фасад над слайсом. */
export const useHelpStore = defineStore('help', () => {
  const help = useHelp();
  return {
    ...help,
    reset() {
      help.reset();
    },
  };
});
