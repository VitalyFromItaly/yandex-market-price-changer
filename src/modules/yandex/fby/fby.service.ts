import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { ErrorReporter } from '../../errors/error-reporter.service';
import { moscowClock, moscowDateParam } from '../reports/moscow-day';
import { OrderReportsService } from '../reports/order-reports.service';
import { REPORT, type TReportKey } from '../reports/report-status-map';
import { YandexClientFactory } from '../yandex-client.factory';

import { formatFbyOverview, type IFbyOverviewData } from './fby-message';
import { FbyStockService } from './fby-stock.service';
import { buildFbyWorkbook, fbyFileName } from './fby-workbook';

/** Готовая xlsx-выгрузка остатков FBY для отправки в Telegram. */
export interface IFbyExport {
  buffer: Buffer;
  filename: string;
}

/** Результат сборки экрана: текст-сводка и файл с полными данными. */
export interface IFbyOverviewResult {
  text: string;
  /** Отсутствует ровно тогда, когда остатки не добылись — выгружать нечего. */
  stockExport?: IFbyExport;
}

/** Заявки этих типов надо физически забрать со склада Маркета. */
const WITHDRAW_TYPES = ['WITHDRAW', 'UTILIZATION'];

/**
 * Сводка FBY: остатки по типам, проблемные позиции, заявки на вывоз/утилизацию,
 * «едет до клиента»/«едет обратно» — на одном экране.
 *
 * API-only (как OrderReportsService): только читает Partner API, ничего не
 * пишет и не трогает Mongo. Четыре источника независимы и МЯГКО ДЕГРАДИРУЮТ —
 * каждый в своей safe-обёртке (паттерн ProfitService.returnedOrderIds): сбой
 * одного даёт заглушку в тексте и `errors.report(...)`, но не рушит экран.
 * Собираются одним Promise.all — обёртки не бросают, поэтому общий промис не
 * реджектится.
 *
 * Остатки добывает FbyStockService — тот же источник, что у экрана «🏬 Склады»:
 * отчёт один, лимит его генерации один, значит и цикл добычи один.
 */
@Injectable()
export class FbyService {
  constructor(
    private readonly clients: YandexClientFactory,
    private readonly reports: OrderReportsService,
    private readonly errors: ErrorReporter,
    private readonly stockSource: FbyStockService,
  ) {}

  public async build(
    store: YandexMarketDocument,
    now: Date = new Date(),
  ): Promise<IFbyOverviewResult> {
    const [stock, requests, inTransit, returning] = await Promise.all([
      this.stockSource.safeLoad(store),
      this.safeRequests(store),
      this.safeCount(store, REPORT.IN_TRANSIT),
      this.safeCount(store, REPORT.RETURNING),
    ]);

    const summary = stock.snapshot?.summary ?? null;
    const data: IFbyOverviewData = {
      stock: summary,
      stockError: stock.error,
      requests,
      inTransit,
      returning,
    };

    const text = formatFbyOverview(data, now);

    // Файл строится ВСЕГДА, когда остатки добылись: таблица SKU×склад — тысячи
    // строк, она не влезает в сообщение ни при каком пороге, и «файл только
    // когда длинно» заставляло бы продавца гадать, почему в этот раз его нет.
    let stockExport: IFbyExport | undefined;
    if (summary) {
      const workbook = buildFbyWorkbook(summary);
      stockExport = {
        buffer: workbook.buffer,
        filename: fbyFileName(moscowDateParam(now), moscowClock(now)),
      };
    }

    return { text, stockExport };
  }

  /** Заявки на вывоз/утилизацию. */
  private async safeRequests(store: YandexMarketDocument) {
    try {
      return await this.clients.forStore(store).loadSupplyRequests(WITHDRAW_TYPES);
    } catch (error) {
      this.report(store, error, 'fby:requests', 'заявки FBY');
      return null;
    }
  }

  /** Количество заказов отчёта (IN_TRANSIT/RETURNING) — переиспользуем reports. */
  private async safeCount(store: YandexMarketDocument, key: TReportKey): Promise<number | null> {
    try {
      const result = await this.reports.build(store, key);
      return result.count;
    } catch (error) {
      this.report(store, error, `fby:count:${key}`, `количество ${key}`);
      return null;
    }
  }

  private report(
    store: YandexMarketDocument,
    error: unknown,
    context: string,
    action: string,
  ): void {
    void this.errors.report({
      error,
      source: 'yandex',
      context,
      telegramUserId: store.telegramUserId,
      action,
    });
  }
}
