import { Injectable, Logger } from '@nestjs/common';
import { YandexClientFactory } from '../yandex-client.factory';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { IOrdersQuery, YandexApiClient } from '../yandex-api.client';
import {
  REPORT,
  RETURN_SHIPMENT_STATUS,
  matchesReport,
  reportDefinition,
  type TReportKey,
} from './report-status-map';
import {
  addTotals,
  amountValue,
  orderTotals,
  ZERO_TOTALS,
  type IMoneyTotals,
} from './money';
import { moscowDateParam, moscowDayBounds } from './moscow-day';
import { buildOrdersWorkbook, workbookFileName } from './report-workbook';
import { formatReport } from './report-message';

/** Заказ в объёме, нужном отчётам. */
export interface IReportOrder {
  id?: number;
  status?: string;
  substatus?: string;
  creationDate?: string;
  itemsTotal?: number;
  deliveryTotal?: number;
  items?: Array<{ offerName?: string; count?: number }>;
}

/** Результат выгрузки: либо файл, либо объяснение, почему файла нет. */
export type IReportExport =
  | { empty: true; message: string }
  | { empty: false; buffer: Buffer; filename: string; caption: string };

export interface IReportResult {
  key: TReportKey;
  title: string;
  count: number;
  totals: IMoneyTotals;
  orders: IReportOrder[];
}

/**
 * Четыре отчёта поверх Partner API.
 *
 * Статусы и фильтры даты сюда НЕ зашиты — они читаются из report-status-map.
 * Поэтому «добавьте в „едет обратно“ ещё один подстатус» правится в маппинге и
 * работает здесь без единой правки логики.
 */
@Injectable()
export class OrderReportsService {
  private readonly logger = new Logger(OrderReportsService.name);

  constructor(private readonly clients: YandexClientFactory) {}

  public async build(
    store: YandexMarketDocument,
    key: TReportKey,
    now: Date = new Date(),
  ): Promise<IReportResult> {
    const client = this.clients.forStore(store);
    const definition = reportDefinition(key);

    const orders = await this.collectOrders(client, key, now);
    let totals = orders.reduce<IMoneyTotals>(
      (acc, order) => addTotals(acc, orderTotals(order)),
      ZERO_TOTALS,
    );

    let count = orders.length;

    if (definition.usesReturnsApi) {
      const returns = await this.collectReturns(client, orders);
      totals = addTotals(totals, returns.totals);
      count += returns.count;
    }

    return { key, title: definition.title, count, totals, orders };
  }

  /**
   * Заказы отчёта. Фильтр по статусу уходит в запрос, а `matchesReport`
   * применяется ПОВЕРХ ответа: подстатус Partner API фильтровать не умеет, и
   * без второй проверки в «едет обратно» попали бы все заказы в доставке.
   */
  private async collectOrders(
    client: YandexApiClient,
    key: TReportKey,
    now: Date,
  ): Promise<IReportOrder[]> {
    const definition = reportDefinition(key);
    const query: IOrdersQuery = { status: [...definition.statuses] };

    switch (definition.dateFilter) {
      case 'supplierShipmentDate': {
        const today = moscowDateParam(now);
        query.supplierShipmentDateFrom = today;
        query.supplierShipmentDateTo = today;
        break;
      }
      case 'updatedAt': {
        const bounds = moscowDayBounds(now);
        query.updatedAtFrom = bounds.from;
        query.updatedAtTo = bounds.to;
        break;
      }
      default:
        // 'none' — срез «что сейчас», фильтр даты не нужен.
        break;
    }

    const collected: IReportOrder[] = [];
    for await (const page of client.iterateOrders(query)) {
      for (const raw of page) {
        const order = raw as IReportOrder;
        if (matchesReport(key, order)) collected.push(order);
      }
    }
    return collected;
  }

  /**
   * Возвраты «в пути» из отдельного метода.
   *
   * Один и тот же заказ приходит и сюда, и в список заказов с возвратным
   * подстатусом — считать его дважды нельзя. Дедупликация по orderId: возврат,
   * чей заказ уже посчитан, добавляет только ноль.
   */
  private async collectReturns(
    client: YandexApiClient,
    alreadyCounted: IReportOrder[],
  ): Promise<{ count: number; totals: IMoneyTotals }> {
    const seen = new Set(alreadyCounted.map((order) => order.id).filter((id) => id != null));
    let totals = ZERO_TOTALS;
    let count = 0;

    for await (const page of client.iterateReturns({
      shipmentStatuses: [RETURN_SHIPMENT_STATUS.IN_TRANSIT],
    })) {
      for (const record of page) {
        // Возврат, чей заказ уже посчитан по подстатусу, пропускаем целиком:
        // иначе один невыкуп попадёт в отчёт дважды — и штукой, и суммой.
        if (record.orderId != null && seen.has(record.orderId)) continue;
        if (record.orderId != null) seen.add(record.orderId);

        // У возврата нет разбивки на товары и доставку — сумма одна, и она
        // попадает в обе величины, иначе «с доставкой» окажется меньше товаров.
        const value = amountValue(record.amount);
        totals = addTotals(totals, { items: value, withDelivery: value });
        count += 1;
      }
    }

    return { count, totals };
  }

  /**
   * Выгрузка «едет до клиента» файлом.
   *
   * Пустой результат НЕ отправляет пустой файл: продавец, открывший книгу из
   * одной шапки, решит, что сломался бот, а не что заказов нет.
   */
  public async exportInTransit(
    store: YandexMarketDocument,
    now: Date = new Date(),
  ): Promise<IReportExport> {
    const result = await this.build(store, REPORT.IN_TRANSIT, now);

    if (!result.count) {
      return { empty: true, message: formatReport(result, now) };
    }

    const workbook = buildOrdersWorkbook(result.orders);

    // Про обрезку сообщаем прямо в подписи к файлу: молча урезанная выгрузка
    // выглядит как полная, и расхождение с личным кабинетом продавец найдёт
    // сам, в худший для этого момент.
    const truncated = workbook.truncated
      ? `\n\n⚠️ В файл попали первые ${workbook.rows} заказов из ${result.count}: остальные не поместились.`
      : '';

    return {
      empty: false,
      buffer: workbook.buffer,
      filename: workbookFileName(moscowDateParam(now)),
      caption: formatReport(result, now) + truncated,
    };
  }

  /** Ключи отчётов — для клавиатуры и роутинга кнопок. */
  public static get keys(): TReportKey[] {
    return Object.values(REPORT);
  }
}
