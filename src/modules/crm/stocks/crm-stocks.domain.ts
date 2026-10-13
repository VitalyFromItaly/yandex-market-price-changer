import type { IStockLevels } from '../../yandex/stocks/stock-levels.service';

import { fbyStockUnavailableLine } from '../../yandex/fby/fby-message';
import { isFby } from '../../yandex/stocks/placement';
import { LOW_STOCK_THRESHOLD } from '../../yandex/stocks/stock-levels';
import { withoutIcon } from '../jobs/crm-jobs.domain';

/** Kind остатков по товарам для главной CRM. Только чтение. */
export const STOCKS_JOB_KIND = 'stocks:by-sku';

/**
 * Ответ kind-а. `data` никогда не null (урок TASK-084): без остатков —
 * `stocks: null` и причина текстом бота, без значка.
 */
export interface ICrmStocksView {
  /** FBY → ссылка «на исходе» ведёт в «FBY», иначе — в «Прайс». */
  fby: boolean;
  takenAt: string | null;
  threshold: number;
  stocks: Record<string, number> | null;
  problem: string | null;
}

export function toCrmStocksView(levels: IStockLevels): ICrmStocksView {
  return {
    fby: isFby(levels.placement),
    takenAt: levels.takenAt ? levels.takenAt.toISOString() : null,
    threshold: LOW_STOCK_THRESHOLD,
    stocks: levels.stocks,
    problem: levels.stocks ? null : withoutIcon(fbyStockUnavailableLine(levels.error)),
  };
}
