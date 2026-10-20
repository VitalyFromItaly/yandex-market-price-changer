import type { OrderDetailResponse } from '../order-feed.domain';

import { formatDay, formatKopecks } from '@/shared/utils';

export interface OrderHistoryRow {
  key: string;
  day: string;
  article: string;
  /** Что за операция по словам площадки: услуга или тип операции. */
  service: string;
  amount: string;
  /** Себестоимость строки продажи/возврата; null — строка товар не двигает. */
  cogs: string | null;
}

/** История операций заказа → строки таблицы диалога. Статья — подписью из ответа. */
export function historyRows(detail: OrderDetailResponse): OrderHistoryRow[] {
  const titles = new Map(detail.articles.map((a) => [a.article, a.title]));
  return detail.history.map((op, index) => ({
    key: `${op.id}:${op.article}:${index}`,
    day: formatDay(op.accruedDay),
    article: titles.get(op.article) ?? op.article,
    service: op.serviceName || op.transactionType,
    amount: formatKopecks(op.amountKopecks),
    cogs: op.cogsKopecks === null ? null : formatKopecks(op.cogsKopecks),
  }));
}
