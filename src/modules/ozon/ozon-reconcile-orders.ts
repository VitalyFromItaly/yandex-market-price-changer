import type { TOzonScheme } from './ozon-orders';
import type { IOzonPosting, OzonSellerClient } from './ozon.client';
import type { IFinancePeriod } from '../finance/finance-period';
import type { IReconcileOrders } from '../finance/finance-reconcile.service';
import type { IMarketplaceOrder } from '../marketplaces/marketplace-adapter';

import {
  RECONCILE_ACCRUED_BEFORE_DAYS,
  reconcileWindows,
} from '../finance/finance-reconcile.service';
import { windowMoments } from '../marketplaces/order-windows';

import { ozonMarketplaceOrder } from './ozon-orders';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `ГГГГ-ММ-ДД` минус дни — календарно, через полдень UTC (без сдвига часовых поясов). */
function isoMinusDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Отправления Ozon как заказы сверки (TASK-132). Только чтение.
 *
 * Выкуплено в месяце = отправление, оформленное в месяце (`in_process_at` —
 * единственный фильтр методов списка, даты выкупа в них нет) и сейчас
 * `delivered` (этап `redeemed`). Так каждое отправление сверяется ровно один
 * раз — в месяце оформления; продажа по нему ищется по всему журналу окна
 * сверки, поэтому без загруженного следующего месяца сверка «не проверена».
 *
 * Существует = есть среди ВСЕХ отправлений (и отменённых) за
 * `RECONCILE_ACCRUED_BEFORE_DAYS` до месяца и сам месяц — то же окно, что
 * журнал сверки. Отправление старше окна даст «начисление без заказа» —
 * ограничение записано в README модуля.
 *
 * Обход один на источник: оба вопроса сверки отвечаются одним списком, квота
 * на ключ одна. Окна FBS и FBO — по очереди.
 */
export function ozonReconcileOrders(
  client: OzonSellerClient,
  now: Date = new Date(),
): IReconcileOrders {
  let listed: Promise<IMarketplaceOrder[]> | null = null;
  const postings = (period: IFinancePeriod) => (listed ??= listPostings(client, period, now));

  return {
    deliveredIn: async (period) => {
      const ids = new Set<string>();
      for (const order of await postings(period)) {
        const day = order.createdDay;
        if (order.stage === 'redeemed' && day && day >= period.from && day <= period.to) {
          ids.add(order.id);
        }
      }
      return ids;
    },
    existing: async (orderIds, period) => {
      const known = new Set((await postings(period)).map((order) => order.id));
      return new Set(orderIds.filter((id) => known.has(id)));
    },
  };
}

async function listPostings(
  client: OzonSellerClient,
  period: IFinancePeriod,
  now: Date,
): Promise<IMarketplaceOrder[]> {
  const span = { from: isoMinusDays(period.from, RECONCILE_ACCRUED_BEFORE_DAYS), to: period.to };
  const byId = new Map<string, IMarketplaceOrder>();
  for (const window of reconcileWindows(span)) {
    const { since, to } = windowMoments(window, now);
    const sources: [TOzonScheme, IOzonPosting[]][] = [
      ['FBS', await client.listFbsPostings(since, to)],
      ['FBO', await client.listFboPostings(since, to)],
    ];
    for (const [scheme, list] of sources) {
      // Отправление на границе окон приходит дважды — считаем один раз.
      for (const posting of list)
        byId.set(posting.postingNumber, ozonMarketplaceOrder(posting, scheme));
    }
  }
  return [...byId.values()];
}
