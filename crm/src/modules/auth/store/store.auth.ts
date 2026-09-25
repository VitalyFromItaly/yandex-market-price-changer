import { defineStore } from 'pinia';

import { useAuthActions } from './composables/useAuthActions.auth';
import { useAuthSession } from './composables/useAuthSession.auth';

/**
 * Стор входа. Единственный стор CRM без reset(): у него clear(), который зовут
 * только выход и 401. resetAllStores (смена магазина) его не трогает.
 */
export const useAuthStore = defineStore('auth', () => {
  const { setSession, ...session } = useAuthSession();
  const actions = useAuthActions(setSession, session.loadMe);
  return { ...session, ...actions };
});
