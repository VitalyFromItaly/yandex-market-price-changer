import type { IWbOrderFacts } from './wb-orders';
import type { IWbFbsOrder } from './wb.client';
import type { IMarketplaceOrders } from '../marketplaces/marketplace-adapter';
import type { ICalendarDate } from '../yandex/reports/moscow-day';
import type { IReportPeriod } from '../yandex/reports/report-period';

import { Injectable, Logger } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { marketplaceOrderWindows, windowMoments } from '../marketplaces/order-windows';

import { WbClientFactory } from './wb-client.factory';
import { wbMarketplaceOrder } from './wb-orders';
import { wbSellerClient } from './wb-seller-client';

/**
 * Заказы WB за период → заказы общего формата (TASK-135). Только чтение.
 *
 * Три источника, ключ — `srid` (штука товара):
 * - «Статистика» supplier/orders — все заказы FBW и FBS, с ценой и отменой;
 * - «Статистика» supplier/sales — выкуп (S…) или возврат (R…) той же штуки;
 * - «Маркетплейс» /api/v3/orders + статусы — у FBS этап точнее статистики, и
 *   только он отличает отказ покупателя от отмены.
 *
 * Статистика запрашивается с первого дня периода: `dateFrom` у неё — дата
 * ИЗМЕНЕНИЯ, поэтому выкуп заказа периода, случившийся позже, тоже придёт, а
 * заказы, созданные раньше и изменённые в периоде, отсекает фильтр по дню
 * оформления. Задания FBS — окнами ≤ 30 дней (лимит метода).
 */
@Injectable()
export class WbOrdersService {
  private readonly logger = new Logger(WbOrdersService.name);

  constructor(
    private readonly clients: WbClientFactory,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  async listOrders(
    telegramUserId: string,
    period: IReportPeriod,
    now: Date = new Date(),
  ): Promise<IMarketplaceOrders> {
    const client = await wbSellerClient(this.clients, this.connections, telegramUserId);
    const windows = marketplaceOrderWindows(period, now);
    const from = isoDay(windows[0].from);
    const to = isoDay(windows[windows.length - 1].to);

    const facts = new Map<string, IWbOrderFacts>();
    const factOf = (srid: string) => {
      let fact = facts.get(srid);
      if (!fact) facts.set(srid, (fact = { srid }));
      return fact;
    };

    // Страницы статистики пересекаются на стыке — последняя строка побеждает.
    for (const row of await client.listSupplierOrders(from)) factOf(row.srid).order = row;
    for (const row of await client.listSupplierSales(from)) {
      const fact = facts.get(row.srid);
      // Продажа без заказа — заказ вне выборки (оформлен до периода).
      if (!fact) continue;
      // Возврат после выкупа окончателен: поздний S его не перекрывает.
      if (fact.sale?.saleID.toUpperCase().startsWith('R')) continue;
      fact.sale = row;
    }

    const fbsById = new Map<string, IWbFbsOrder>();
    for (const window of windows) {
      const { since, to: until } = windowMoments(window, now);
      for (const order of await client.listFbsOrders(since, until)) fbsById.set(order.id, order);
    }
    if (fbsById.size) {
      const statuses = new Map(
        (await client.fbsOrderStatuses([...fbsById.keys()])).map((s) => [s.id, s]),
      );
      for (const order of fbsById.values()) {
        const fact = factOf(order.rid || `fbs-${order.id}`);
        fact.fbs = order;
        fact.fbsStatus = statuses.get(order.id);
      }
    }

    const all = [...facts.values()]
      .map(wbMarketplaceOrder)
      .filter((order) => order.createdDay !== null && order.createdDay >= from)
      .filter((order) => order.createdDay <= to);

    const unknown = [
      ...new Set(
        all.filter((o) => o.stage === 'unknown').map((o) => `${o.status}/${o.substatus ?? ''}`),
      ),
    ];
    if (unknown.length) {
      this.logger.warn(
        `WB ${telegramUserId}: незнакомые статусы заданий ${unknown.join(', ')} — этап «неизвестно»`,
      );
    }
    return {
      orders: all.filter((order) => order.stage !== 'cancelled'),
      cancelled: all.filter((order) => order.stage === 'cancelled'),
    };
  }
}

function isoDay(date: ICalendarDate): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}
