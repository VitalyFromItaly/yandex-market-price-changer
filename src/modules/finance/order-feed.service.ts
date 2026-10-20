import type { IOrderFeed, IOrderProfit } from './order-feed';
import type { IPnlOperation } from './pnl';
import type { TMarketplace } from '../../shared/marketplace';
import type { IMarketplaceOrder } from '../marketplaces/marketplace-adapter';

import { Injectable } from '@nestjs/common';

import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';

import { financeToday } from './finance-period';
import { FinanceService } from './finance.service';
import { orderFeedOf, orderProfitOf } from './order-feed';
import { cogsOf, pnlLineOf } from './pnl';

/** Строка истории операций заказа — часть операции журнала по статье. */
export interface IOrderHistoryOperation {
  /** id операции в finance_operations; части одной операции делят его. */
  id: string;
  /** ГГГГ-ММ-ДД по Москве — день начисления. */
  accruedDay: string;
  paidDay: string | null;
  article: IPnlOperation['article'];
  serviceName: string | null;
  transactionType: string;
  amountKopecks: number;
  /** Себестоимость строки, двигающей товар; null — строка товар не двигает или закупа нет. */
  cogsKopecks: number | null;
}

export interface IOrderDetail extends IOrderProfit {
  marketplace: TMarketplace;
  orderId: string;
  history: IOrderHistoryOperation[];
}

/**
 * «Лента заказов» (TASK-144): заказы площадок → прибыль по журналу. Заказы
 * приносит вызывающий (реестр площадок и отчёты ЯМ — их дверь), здесь —
 * только журнал и закуп: та же себестоимость, что у P&L (`costOfSkus`).
 * Площадки читаются и считаются раздельно — журнал скоупится площадкой.
 */
@Injectable()
export class OrderFeedService {
  constructor(
    private readonly operations: FinanceOperationRepository,
    private readonly finance: FinanceService,
  ) {}

  async list(
    telegramUserId: string,
    marketplace: TMarketplace,
    orders: readonly IMarketplaceOrder[],
  ): Promise<IOrderFeed> {
    const operations = await this.operations.liveByOrderIds(
      telegramUserId,
      orders.map((order) => order.id),
      marketplace,
    );
    const costOf = await this.finance.costOfSkus(telegramUserId, skusOf(operations));
    return orderFeedOf(marketplace, orders, operations, costOf);
  }

  async detail(
    telegramUserId: string,
    marketplace: TMarketplace,
    orderId: string,
  ): Promise<IOrderDetail> {
    const operations = await this.operations.liveByOrderIds(telegramUserId, [orderId], marketplace);
    const costOf = await this.finance.costOfSkus(telegramUserId, skusOf(operations));
    const lines = operations.map(pnlLineOf);
    const { lineCogs } = cogsOf(lines, costOf);
    return {
      marketplace,
      orderId,
      ...orderProfitOf(operations, costOf),
      history: operations.map((op, index) => ({
        id: op.id,
        accruedDay: financeToday(op.accruedAt),
        paidDay: op.paidAt ? financeToday(op.paidAt) : null,
        article: op.article,
        serviceName: op.serviceName,
        transactionType: op.transactionType,
        amountKopecks: op.amountKopecks,
        cogsKopecks: lines[index].goods ? (lineCogs.get(lines[index].id) ?? null) : null,
      })),
    };
  }
}

function skusOf(operations: readonly IPnlOperation[]): string[] {
  return operations.map((op) => op.sku).filter((sku): sku is string => Boolean(sku));
}
