import type { TMarketplace } from '../../../shared/marketplace';
import type { TOrderStage } from '../../../shared/order-stage';
import type { IOrderFeed, IOrderFeedArticle, TOrderProfitGap } from '../../finance/order-feed';
import type { IReportPeriod } from '../../yandex/reports/report-period';
import type { ICrmPeriodEcho } from '../jobs/crm-period.domain';

import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { ORDER_STAGES, ORDER_STAGE_LABEL } from '../../../shared/order-stage';
import { periodTitle } from '../../yandex/reports/report-period';
import { periodEcho } from '../jobs/crm-period.domain';

/**
 * «Лента заказов» CRM (TASK-144) — доставка. Прибыль заказа считает лист
 * `finance/order-feed.ts`; здесь — состояние площадок, тексты оговорок и
 * перечисление полей ответа. Имя не «orders»: тот раздел — отчёты ЯМ по магазину.
 */

export const ORDER_FEED_KIND = 'order-feed:list';

export const ORDER_FEED_ACT_NOTE =
  'Услуги Яндекс Маркета из сводной строки акта (хранение, обработка возвратов и т. п.) ' +
  'номера заказа не несут — в расходы заказа они не входят.';

export const ORDER_FEED_OZON_RETURNS_NOTE =
  'Ozon не отдаёт возвраты отправлений — этапов «Возвращается» и «Возвращён» у Ozon нет.';

export const ORDER_FEED_WB_NOTE =
  'WB: открытый заказ FBW — «В пути», промежуточных статусов статистика не знает; ' +
  'отказ при получении FBW виден как отмена.';

export const ORDER_FEED_NOT_CONNECTED_TEXT = (marketplace: TMarketplace) =>
  `${MARKETPLACE_LABEL[marketplace]} не подключён — ключ задаётся в «Подключениях».`;

/** Почему у площадки нет заказов — строкой под таблицей, не пустотой. */
export interface ICrmOrderFeedProblem {
  marketplace: TMarketplace;
  storeName: string | null;
  problem: string;
}

export type TCrmOrderFeedState = 'ok' | 'not-connected' | 'failed';

export interface ICrmOrderFeedMarketplace {
  marketplace: TMarketplace;
  label: string;
  state: TCrmOrderFeedState;
}

export interface ICrmOrderFeedItem {
  sku: string;
  name: string | null;
  count: number;
}

export interface ICrmOrderFeedRow {
  marketplace: TMarketplace;
  /** Номер, по которому журнал ищет операции: ЯМ — заказ, Ozon — отправление, WB — srid. */
  id: string;
  /** Номер, который продавец видит в кабинете площадки. */
  orderNumber: string;
  scheme: string | null;
  stage: TOrderStage;
  stageLabel: string;
  status: string;
  createdDay: string | null;
  items: ICrmOrderFeedItem[];
  /** «Продажи» заказа по данным площадки; null — площадка не сказала. */
  sales: number | null;
  operations: number;
  operationsKopecks: number | null;
  cogsKopecks: number | null;
  profitKopecks: number | null;
  profitGap: TOrderProfitGap | null;
  articles: IOrderFeedArticle[];
}

export interface ICrmOrderFeedTotals {
  marketplace: TMarketplace;
  label: string;
  orders: number;
  withOperations: number;
  profitKopecks: number;
  profitOrders: number;
}

export interface ICrmOrderFeedView {
  /** Площадка экрана (эхо `params.marketplace`) — стор сверяет по ней свой ответ. */
  marketplace: TMarketplace;
  /** Эхо запрошенного периода: фронт распознаёт по нему ответ чужой задачи. */
  period: ICrmPeriodEcho;
  periodTitle: string;
  marketplaces: ICrmOrderFeedMarketplace[];
  /** Этапы фильтра — все 10 по порядку; «Неизвестно» — только если такие заказы есть. */
  stages: { stage: TOrderStage; label: string }[];
  /** Итоги по площадкам раздельно: общего числа нет. */
  totals: ICrmOrderFeedTotals[];
  rows: ICrmOrderFeedRow[];
  problems: ICrmOrderFeedProblem[];
  notes: string[];
}

export interface ICrmOrderFeedInput {
  period: IReportPeriod;
  now: Date;
  marketplace: TMarketplace;
  marketplaces: ICrmOrderFeedMarketplace[];
  feeds: IOrderFeed[];
  problems: ICrmOrderFeedProblem[];
  notes: string[];
}

export function toCrmOrderFeed(input: ICrmOrderFeedInput): ICrmOrderFeedView {
  const rows: ICrmOrderFeedRow[] = input.feeds
    .flatMap((feed) => feed.rows)
    .map(({ order, ...profit }) => ({
      marketplace: order.marketplace,
      id: order.id,
      orderNumber: order.orderNumber,
      scheme: order.scheme,
      stage: order.stage,
      stageLabel: profit.stageLabel,
      status: order.status,
      createdDay: order.createdDay,
      items: order.items.map((item) => ({
        sku: item.sku,
        name: item.name ?? null,
        count: item.count,
      })),
      sales: order.sales,
      operations: profit.operations,
      operationsKopecks: profit.operationsKopecks,
      cogsKopecks: profit.cogsKopecks,
      profitKopecks: profit.profitKopecks,
      profitGap: profit.profitGap,
      articles: profit.articles,
    }))
    .sort((a, b) => (b.createdDay ?? '').localeCompare(a.createdDay ?? ''));

  const hasUnknown = rows.some((row) => row.stage === 'unknown');
  return {
    marketplace: input.marketplace,
    period: periodEcho(input.period),
    periodTitle: periodTitle(input.period, input.now),
    marketplaces: input.marketplaces,
    stages: ORDER_STAGES.filter((stage) => stage !== 'unknown' || hasUnknown).map((stage) => ({
      stage,
      label: ORDER_STAGE_LABEL[stage],
    })),
    totals: input.feeds.map((feed) => ({
      ...feed.totals,
      label: MARKETPLACE_LABEL[feed.totals.marketplace],
    })),
    rows,
    problems: input.problems,
    notes: input.notes,
  };
}
