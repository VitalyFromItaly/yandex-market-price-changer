import type { JournalMarketplace, JournalMonth, JournalPullResult } from './financeJournal.domain';

import { http } from '@/shared/http';

const BASE = '/ym/finance';

/** Журнал площадки по месяцам и «Загрузить из Маркета» (`finance_pull`). */
export const financeJournalApi = {
  months: async (marketplace: JournalMarketplace): Promise<JournalMonth[]> =>
    (
      await http.get<{ months: JournalMonth[] }>(
        `${BASE}/months?marketplace=${encodeURIComponent(marketplace)}`,
      )
    ).months,

  /** Ставит загрузку месяцев и сразу отвечает: готовность видна по `checkedAt` в `months`. */
  pull: (marketplace: JournalMarketplace, months: readonly string[]) =>
    http.post<JournalPullResult>(`${BASE}/pull`, { marketplace, months }),
};
