import type { TOzonScheme } from './ozon-orders';
import type { IOzonPosting } from './ozon.client';
import type {
  IMarketplaceOrder,
  IMarketplaceOrders,
  IMarketplaceRawOrderLine,
} from '../marketplaces/marketplace-adapter';
import type { IReportPeriod } from '../yandex/reports/report-period';

import { Injectable, Logger } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { marketplaceOrderWindows, windowMoments } from '../marketplaces/order-windows';

import { OzonClientFactory } from './ozon-client.factory';
import { ozonMarketplaceOrder } from './ozon-orders';
import { ozonSellerClient } from './ozon-seller-client';

/**
 * Отправления Ozon за период → заказы общего формата (TASK-130). Только чтение.
 *
 * Период режется теми же окнами, что заказы ЯМ (`periodWindows`, ≤ 30 дней):
 * метод FBS принимает до года, но одно окно на год — это тысячи страниц по 50
 * с одним сбоем на всех. «Всего» — последние 30 дней, как неявное окно ЯМ.
 * Окна, FBS и FBO обходятся по очереди: квота на ключ одна.
 */
@Injectable()
export class OzonOrdersService {
  private readonly logger = new Logger(OzonOrdersService.name);

  constructor(
    private readonly clients: OzonClientFactory,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  async listOrders(
    telegramUserId: string,
    period: IReportPeriod,
    now: Date = new Date(),
  ): Promise<IMarketplaceOrders> {
    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const byId = new Map<string, IMarketplaceOrder>();
    for (const window of ozonWindows(period, now)) {
      const { since, to } = windowMoments(window, now);
      const sources: [TOzonScheme, IOzonPosting[]][] = [
        ['FBS', await client.listFbsPostings(since, to)],
        ['FBO', await client.listFboPostings(since, to)],
      ];
      for (const [scheme, postings] of sources) {
        // Отправление на границе окон приходит дважды — считаем один раз.
        for (const posting of postings) {
          byId.set(posting.postingNumber, ozonMarketplaceOrder(posting, scheme));
        }
      }
    }

    const all = [...byId.values()];
    const unknown = [...new Set(all.filter((o) => o.stage === 'unknown').map((o) => o.status))];
    if (unknown.length) {
      this.logger.warn(
        `Ozon ${telegramUserId}: незнакомые статусы отправлений ${unknown.join(', ')} — этап «неизвестно»`,
      );
    }
    return {
      orders: all.filter((order) => order.stage !== 'cancelled'),
      cancelled: all.filter((order) => order.stage === 'cancelled'),
    };
  }

  /**
   * Сырые отправления FBS и FBO с `financial_data`, начатые в `window`
   * (снимок строк заказов «Финучёта», TASK-211). Окно режется на куски ≤ 30
   * дней, как заказы; отправление на стыке кусков — один раз (последнее).
   */
  async rawOrderLines(
    telegramUserId: string,
    window: { from: Date; to: Date },
  ): Promise<IMarketplaceRawOrderLine[]> {
    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const byNumber = new Map<string, IMarketplaceRawOrderLine>();
    const keep = (kind: IMarketplaceRawOrderLine['kind'], raw: Record<string, unknown>) => {
      const number = typeof raw.posting_number === 'string' ? raw.posting_number : '';
      if (number) byNumber.set(number, { kind, raw });
    };
    for (let start = window.from.getTime(); start < window.to.getTime(); start += RAW_WINDOW_MS) {
      const since = new Date(start);
      const to = new Date(Math.min(start + RAW_WINDOW_MS, window.to.getTime()));
      for (const raw of await client.listFbsPostingsRaw(since, to)) keep('ozon-fbs', raw);
      for (const raw of await client.listFboPostingsRaw(since, to)) keep('ozon-fbo', raw);
    }
    return [...byNumber.values()];
  }
}

/** Шаг окна сырого обхода: тот же предел 30 дней, что у заказов. */
const RAW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Окна периода; «Всего» — последние 30 московских дней по сегодня. */
export const ozonWindows = marketplaceOrderWindows;
export { windowMoments };
