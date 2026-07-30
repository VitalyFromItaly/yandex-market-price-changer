import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { IProfitTotals } from './profit';
import type { IReportPeriod } from './report-period';

import { Injectable, Logger } from '@nestjs/common';

import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { YandexClientFactory } from '../yandex-client.factory';

import { OrderReportsService } from './order-reports.service';
import { applyDiscounts, orderSkus, profitOf, ratesOf } from './profit';
import { DEFAULT_PERIOD } from './report-period';
import { REPORT } from './report-status-map';

export interface IProfitReport {
  period: IReportPeriod;
  totals: IProfitTotals;
  /** Когда последний раз загружали прайс. null — закупа нет вовсе. */
  pricesUpdatedAt: Date | null;
}

/**
 * Сборка отчёта о прибыли.
 *
 * Отдельный сервис, а не метод в OrderReportsService: тот работает только с
 * Partner API и ничего не знает о Mongo. Прибыль — это соединение двух
 * источников, заказов и закупочных цен, и склеивать их место здесь.
 */
@Injectable()
export class ProfitService {
  private readonly logger = new Logger(ProfitService.name);

  constructor(
    private readonly reports: OrderReportsService,
    private readonly purchasePrices: PurchasePriceService,
    private readonly clients: YandexClientFactory,
  ) {}

  public async build(
    store: YandexMarketDocument,
    period: IReportPeriod = DEFAULT_PERIOD,
    now: Date = new Date(),
  ): Promise<IProfitReport> {
    // Заказы берём тем же кодом, что и остальные отчёты: статусы, фильтр даты,
    // проверка 30-дневного окна и обход страниц — всё уже там.
    const result = await this.reports.build(store, REPORT.PROFIT, now, period);

    const skus = orderSkus(result.orders);
    const rates = ratesOf(store);

    // Один запрос на весь отчёт: артикулов за месяц бывают сотни.
    const rows = await this.purchasePrices.findBySkus(store.telegramUserId, skus);

    // В базе лежит цена ПРАЙСА; закуп получается вычетом скидки — своей у
    // «Востока», своей у остального. Поэтому смена процента действует сразу, без
    // перезагрузки файла.
    const costs = applyDiscounts(rows, rates);

    const returned = await this.returnedOrderIds(store);
    const totals = profitOf(result.orders, costs, rates, { returned });

    this.logger.log(
      `Прибыль для ${store.telegramUserId}: заказов ${totals.orders}, ` +
        `исключено ${totals.excludedOrders}, возвращено ${totals.returnedOrders}, ` +
        `закуп известен по ${costs.size} из ${skus.length}`,
    );

    return {
      period: result.period,
      totals,
      pricesUpdatedAt: await this.purchasePrices.lastUpdatedAt(store.telegramUserId),
    };
  }

  /**
   * Заказы, по которым есть возврат.
   *
   * Метод возвратов опрашивается БЕЗ фильтра по статусу отгрузки и без периода —
   * и то и другое намеренно:
   *
   * - статус отгрузки («в пути», «доставлен продавцу») говорит, где сейчас
   *   посылка, а не вернулись ли деньги; отчёт «Едет обратно» фильтрует по нему
   *   потому, что он про путь товара, а прибыль — про деньги;
   * - возврат июльского заказа могли оформить в августе, и прибыль за июль
   *   обязана перестать его считать. Пересечение с периодом делает уже `profitOf`
   *   по списку заказов отчёта.
   *
   * Отказ метода возвратов НЕ роняет отчёт: прибыль без вычета возвратов полезнее
   * сообщения об ошибке, но в лог это попадает предупреждением — иначе завышенная
   * прибыль выглядела бы нормальной.
   */
  private async returnedOrderIds(store: YandexMarketDocument): Promise<Set<number | string>> {
    const ids = new Set<number | string>();

    try {
      const client = this.clients.forStore(store);
      for await (const page of client.iterateReturns({})) {
        for (const record of page) {
          if (record.orderId != null) ids.add(record.orderId);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Возвраты для ${store.telegramUserId} получить не удалось, ` +
          `прибыль посчитана БЕЗ их вычета: ${(error as Error)?.message}`,
      );
    }

    return ids;
  }
}
