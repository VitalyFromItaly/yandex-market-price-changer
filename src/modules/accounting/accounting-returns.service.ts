import type { IAccountingReturnsSummary } from './accounting-returns.domain';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';
import type { IFinancePeriod } from '../finance/finance-period';

import { Injectable } from '@nestjs/common';

import { AccountingOrderCardService } from './accounting-order-card.service';
import { returnsSummaryOf } from './accounting-returns.domain';
import { AccountingService } from './accounting.service';

type TFeatures = Readonly<Record<string, boolean>>;

export interface IAccountingReturns extends IAccountingReturnsSummary {
  period: IFinancePeriod;
}

/**
 * «Возвраты» «Финучёта» (TASK-225): заказы месяца оформления магазина из URL —
 * те же карточки, что список заказов (`periodOrders`), результат возврата —
 * `returnResultOf`. ЯМ без магазина не показывается (как панель и список заказов).
 */
@Injectable()
export class AccountingReturnsService {
  constructor(
    private readonly accounting: AccountingService,
    private readonly orderCards: AccountingOrderCardService,
  ) {}

  async month(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    month: IFinancePeriod,
    now: Date = new Date(),
  ): Promise<IAccountingReturns> {
    const enabled = await this.accounting.marketplacesOf(telegramUserId, features);
    const marketplaces: TFinanceMarketplace[] = enabled.filter(
      (m) => m !== 'ym' || Boolean(store?.campaign_id),
    );
    const orders = await this.orderCards.periodOrders(
      telegramUserId,
      features,
      store,
      month,
      {},
      now,
    );
    return { period: month, ...returnsSummaryOf(orders, marketplaces) };
  }
}
