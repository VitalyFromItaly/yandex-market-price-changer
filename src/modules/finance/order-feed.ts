/**
 * «Лента заказов» (TASK-144, ТЗ п.11) — прибыль заказа из журнала. Чистая
 * функция — без Nest и базы; данные собирает `OrderFeedService`.
 *
 * Правило: прибыль заказа = Σ его операций журнала − себестоимость.
 * - операции заказа — живые строки журнала с его номером (ЯМ — id заказа,
 *   Ozon — posting_number, WB — srid), сводные строки уже разложены по статьям
 *   (`expandBreakdown`); услуги сводной строки акта ЯМ без номера заказа сюда
 *   не входят и не распределяются (решение `order_feed_order_ops_only`);
 * - `bonus_payment` — справочно, вне суммы, как в P&L;
 * - себестоимость — `cogsOf` P&L по строкам заказа, двигающим товар, на день
 *   строки (`pnl_cogs_sale_day`): у заказа то же правило, что у отчёта;
 * - операций нет — прибыль `null` (`order_feed_no_ops_null`), не 0 и не оценка;
 *   закупа нет хотя бы у одной строки товара — тоже `null`: неизвестное не ноль.
 *
 * Деньги — целые копейки со знаком площадки: «+» продавцу, «−» удержание.
 */

import type { TFinanceArticle, TFinanceArticleGroup } from './finance-articles';
import type { IPnlOperation, TPnlCostOf } from './pnl';
import type { TMarketplace } from '../../shared/marketplace';
import type { IMarketplaceOrder } from '../marketplaces/marketplace-adapter';

import { ORDER_STAGE_LABEL } from '../../shared/order-stage';

import { FINANCE_ARTICLE_META } from './finance-articles';
import { cogsOf, pnlLineOf } from './pnl';

/** Почему прибыли заказа нет. */
export type TOrderProfitGap = 'no-operations' | 'no-cost';

/** Статья заказа: Σ его частей журнала по статье. */
export interface IOrderFeedArticle {
  article: TFinanceArticle;
  title: string;
  group: TFinanceArticleGroup;
  kopecks: number;
}

/** Деньги заказа по журналу. */
export interface IOrderProfit {
  /** Различных операций журнала у заказа. */
  operations: number;
  /** Σ операций без справочных; null — операций нет. */
  operationsKopecks: number | null;
  /** Себестоимость проданного минус вернувшегося; null — нет операций или закупа. */
  cogsKopecks: number | null;
  profitKopecks: number | null;
  profitGap: TOrderProfitGap | null;
  /** По статьям, в порядке справочника статей; справочные — тоже, с группой `reference`. */
  articles: IOrderFeedArticle[];
}

export interface IOrderFeedRow extends IOrderProfit {
  order: IMarketplaceOrder;
  stageLabel: string;
}

/** Итог площадки. Площадки не складываются: экран показывает каждую своей строкой. */
export interface IOrderFeedTotals {
  marketplace: TMarketplace;
  orders: number;
  /** Заказов, у которых в журнале есть операции. */
  withOperations: number;
  /** Σ прибыли заказов, у которых она посчитана. */
  profitKopecks: number;
  /** Заказов с посчитанной прибылью. */
  profitOrders: number;
}

export interface IOrderFeed {
  rows: IOrderFeedRow[];
  totals: IOrderFeedTotals;
}

const ARTICLE_ORDER = Object.keys(FINANCE_ARTICLE_META) as TFinanceArticle[];

/**
 * Прибыль одного заказа по его операциям — уже разложенным по статьям (как их
 * отдаёт `liveByOrderIds`; части одной операции несут её id).
 */
export function orderProfitOf(
  operations: readonly IPnlOperation[],
  costOf: TPnlCostOf,
): IOrderProfit {
  if (!operations.length) {
    return {
      operations: 0,
      operationsKopecks: null,
      cogsKopecks: null,
      profitKopecks: null,
      profitGap: 'no-operations',
      articles: [],
    };
  }

  const byArticle = new Map<TFinanceArticle, number>();
  let operationsKopecks = 0;
  for (const op of operations) {
    byArticle.set(op.article, (byArticle.get(op.article) ?? 0) + op.amountKopecks);
    if (FINANCE_ARTICLE_META[op.article].group !== 'reference') {
      operationsKopecks += op.amountKopecks;
    }
  }

  const { cogs } = cogsOf(operations.map(pnlLineOf), costOf);
  const costKnown = cogs.unknown.length === 0;
  const cogsKopecks = costKnown ? cogs.kopecks : null;

  return {
    operations: new Set(operations.map((op) => op.id)).size,
    operationsKopecks,
    cogsKopecks,
    profitKopecks: cogsKopecks === null ? null : operationsKopecks - cogsKopecks,
    profitGap: costKnown ? null : 'no-cost',
    articles: ARTICLE_ORDER.filter((article) => byArticle.has(article)).map((article) => ({
      article,
      title: FINANCE_ARTICLE_META[article].title,
      group: FINANCE_ARTICLE_META[article].group,
      kopecks: byArticle.get(article) as number,
    })),
  };
}

/**
 * Лента одной площадки: заказы периода и операции журнала по их номерам.
 * Строки — от новых к старым; заказ без дня — в конце.
 */
export function orderFeedOf(
  marketplace: TMarketplace,
  orders: readonly IMarketplaceOrder[],
  operations: readonly IPnlOperation[],
  costOf: TPnlCostOf,
): IOrderFeed {
  const byOrder = new Map<string, IPnlOperation[]>();
  for (const op of operations) {
    if (!op.orderId) continue;
    const list = byOrder.get(op.orderId) ?? [];
    list.push(op);
    byOrder.set(op.orderId, list);
  }

  const rows = orders
    .map((order) => ({
      order,
      stageLabel: ORDER_STAGE_LABEL[order.stage],
      ...orderProfitOf(byOrder.get(order.id) ?? [], costOf),
    }))
    .sort((a, b) => (b.order.createdDay ?? '').localeCompare(a.order.createdDay ?? ''));

  const counted = rows.filter((row) => row.profitKopecks !== null);
  return {
    rows,
    totals: {
      marketplace,
      orders: rows.length,
      withOperations: rows.filter((row) => row.operations > 0).length,
      profitKopecks: counted.reduce((sum, row) => sum + (row.profitKopecks as number), 0),
      profitOrders: counted.length,
    },
  };
}
