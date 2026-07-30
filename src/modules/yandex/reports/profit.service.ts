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
  /** Выкупленные за период — деньги, которые уже получены. */
  totals: IProfitTotals;
  /**
   * Оформленные за период — то, что продавец видит в кабинете.
   *
   * ЭТО ДРУГИЕ ЗАКАЗЫ, а не часть выкупленных: сегодняшние заказы выкупят через
   * неделю, а сегодняшние выкупы оформлены раньше. Складывать наборы нельзя, и
   * текст отчёта обязан это проговаривать.
   */
  placed: IProfitTotals;
  /** Отменённые из оформленных за период: в деньги не идут, но в кабинете видны. */
  cancelledOrders: number;
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
    //
    // Два обхода параллельно: это разные фильтры даты (обновление против
    // оформления), объединить их одним запросом нельзя. Отчёт строится по
    // кнопке и раз в сутки, часовой квоте Partner API это ничто.
    const [result, placedOrders] = await Promise.all([
      this.reports.build(store, REPORT.PROFIT, now, period),
      this.reports.collectPlacedOrders(store, period, now),
    ]);

    const rates = ratesOf(store);

    // Артикулы обоих наборов — ОДНИМ запросом к базе: закупочные цены общие, а
    // два запроса на один отчёт означали бы двойной проход по коллекции в
    // 4100 документов ради того же результата.
    const skus = orderSkus([...result.orders, ...placedOrders.orders]);
    const rows = await this.purchasePrices.findBySkus(store.telegramUserId, skus);

    // В базе лежит цена ПРАЙСА; закуп получается вычетом скидки — своей у
    // «Востока», своей у остального. Поэтому смена процента действует сразу, без
    // перезагрузки файла.
    const costs = applyDiscounts(rows, rates);

    // Возвраты запрашиваются ОДИН раз на оба расчёта: список общий, а метод
    // возвратов — самый дорогой запрос отчёта.
    const returned = await this.returnedOrderIds(store);
    const totals = profitOf(result.orders, costs, rates, { returned });
    const placed = profitOf(placedOrders.orders, costs, rates, { returned });

    this.logger.log(
      `Прибыль для ${store.telegramUserId}: выкуплено ${totals.orders}, ` +
        `оформлено ${placed.orders} (отменено ${placedOrders.cancelled.length}), ` +
        `исключено ${totals.excludedOrders}/${placed.excludedOrders}, ` +
        `возвращено ${totals.returnedOrders}, закуп известен по ${costs.size} из ${skus.length}`,
    );

    return {
      period: result.period,
      totals,
      placed,
      cancelledOrders: placedOrders.cancelled.length,
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
