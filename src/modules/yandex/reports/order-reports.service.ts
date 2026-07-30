import { Injectable, Logger } from '@nestjs/common';
import { YandexClientFactory } from '../yandex-client.factory';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { IOrdersQuery, YandexApiClient } from '../yandex-api.client';
import {
  PLACED_DEFINITION,
  REPORT,
  RETURN_SHIPMENT_STATUS,
  isCancelled,
  matchesDefinition,
  queryStatuses,
  reportDefinition,
  type IReportDefinition,
  type TReportKey,
} from './report-status-map';
import {
  addTotals,
  amountValue,
  orderTotals,
  ZERO_TOTALS,
  type IMoneyTotals,
  type IOrderSubsidy,
} from './money';
import { moscowDateParam } from './moscow-day';
import {
  DEFAULT_PERIOD,
  assertPeriodSupported,
  creationDateParams,
  shipmentDateParams,
  updatedAtParams,
  type IReportPeriod,
} from './report-period';
import { buildOrdersWorkbook, workbookFileName } from './report-workbook';
import { formatReport } from './report-message';

/**
 * Позиция заказа в объёме, нужном отчётам.
 *
 * `offerId` — артикул продавца, тот же, что в каталоге и в закупочных ценах.
 * Устаревший синоним `shopSku` не используем: документация прямо велит брать
 * `offerId`, а имя из списка устаревших полей ещё и запрещено тестом.
 *
 * Позиции ПРИХОДИЛИ всегда: `getOrders` отдаёт ответ Яндекса как есть, а отчёты
 * лишь кастуют его к этому интерфейсу. Расширение типа не добавляет ни запроса,
 * ни расхода квоты — только перестаёт выбрасывать уже полученные данные.
 */
export interface IReportOrderItem {
  offerId?: string;
  offerName?: string;
  count?: number;
}

/** Заказ в объёме, нужном отчётам. */
export interface IReportOrder {
  id?: number;
  status?: string;
  substatus?: string;
  creationDate?: string;
  itemsTotal?: number;
  deliveryTotal?: number;
  /**
   * Субсидии Маркета — итог по типам на весь заказ.
   *
   * Нужны прибыли: это вознаграждение партнёру, то есть выручка продавца сверх
   * платежа покупателя (см. subsidiesTotal в money.ts). Приходили всегда, просто
   * не читались — за июль в них 421 тыс. ₽.
   */
  subsidies?: IOrderSubsidy[];
  items?: IReportOrderItem[];
}

/**
 * Результат выгрузки: либо файл, либо объяснение, почему файла нет.
 *
 * Плоская структура, а не дискриминированное объединение: в проекте выключен
 * strictNullChecks, и сужение по литеральному `empty: true` не работает —
 * компилятор просто не даст обратиться к полям файла.
 */
export interface IReportExport {
  empty: boolean;
  /** Заполнено при empty === true. */
  message?: string;
  /** Заполнены при empty === false. */
  buffer?: Buffer;
  filename?: string;
  caption?: string;
}

export interface IReportResult {
  key: TReportKey;
  title: string;
  count: number;
  totals: IMoneyTotals;
  orders: IReportOrder[];
  /** За какой период собран — заголовок сообщения печатает именно его. */
  period: IReportPeriod;
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
    period: IReportPeriod = DEFAULT_PERIOD,
  ): Promise<IReportResult> {
    const client = this.clients.forStore(store);
    const definition = reportDefinition(key);

    const orders = await this.collectOrders(client, definition, now, period);
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

    return { key, title: definition.title, count, totals, orders, period };
  }

  /**
   * Заказы, ОФОРМЛЕННЫЕ за период, с отменёнными отдельным списком.
   *
   * Отдельный публичный метод, а не отчёт: кнопки и рассылки у этого набора
   * нет, он нужен только прибыли — вторым блоком рядом с выкупленными.
   *
   * Отменённые приходят тем же запросом и разделяются здесь: в кабинете
   * продавец видит их в общем списке, поэтому отчёт про них говорит, но в
   * деньги не берёт.
   */
  public async collectPlacedOrders(
    store: YandexMarketDocument,
    period: IReportPeriod = DEFAULT_PERIOD,
    now: Date = new Date(),
  ): Promise<{ orders: IReportOrder[]; cancelled: IReportOrder[] }> {
    const client = this.clients.forStore(store);
    const all = await this.collectOrders(client, PLACED_DEFINITION, now, period);

    return {
      orders: all.filter((order) => !isCancelled(order)),
      cancelled: all.filter((order) => isCancelled(order)),
    };
  }

  /**
   * Заказы отчёта. Фильтр по статусу уходит в запрос, а `matchesDefinition`
   * применяется ПОВЕРХ ответа: подстатус Partner API фильтровать не умеет, и
   * без второй проверки в «едет обратно» попали бы все заказы в доставке.
   *
   * Принимает ОПРЕДЕЛЕНИЕ, а не ключ отчёта: тем же кодом собирается
   * `PLACED_DEFINITION`, у которого ключа нет вовсе.
   */
  private async collectOrders(
    client: YandexApiClient,
    definition: IReportDefinition,
    now: Date,
    period: IReportPeriod,
  ): Promise<IReportOrder[]> {
    // В запрос уходят только те статусы, которые Partner API принимает в
    // фильтре: запрещённое значение отвечает 400 на ВЕСЬ отчёт (см. queryStatuses).
    const query: IOrdersQuery = { status: queryStatuses(definition) };

    // Период проверяем ДО сети — но только там, где он вообще применяется.
    // У среза «что сейчас в пути» фильтра даты нет, и отклонять его из-за
    // слишком старой даты было бы отказом на ровном месте.
    if (definition.dateFilter !== 'none') {
      assertPeriodSupported(period, now);
    }

    switch (definition.dateFilter) {
      case 'supplierShipmentDate': {
        const range = shipmentDateParams(period, now);
        query.supplierShipmentDateFrom = range.from;
        query.supplierShipmentDateTo = range.to;
        break;
      }
      case 'updatedAt': {
        const range = updatedAtParams(period, now);
        query.updatedAtFrom = range.from;
        query.updatedAtTo = range.to;
        break;
      }
      case 'creationDate': {
        // Верхняя граница у Яндекса исключающая — сдвиг на день делает
        // creationDateParams, см. комментарий там.
        const range = creationDateParams(period, now);
        query.fromDate = range.from;
        query.toDate = range.to;
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
        if (matchesDefinition(definition, order)) collected.push(order);
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
