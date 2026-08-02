import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { YandexApiClient } from '../yandex-api.client';
import type { TFbyStockError } from './fby-message';
import type { IFbyStockSummary } from './fby-stock-report';

import { Injectable } from '@nestjs/common';

import { ErrorReporter } from '../../errors/error-reporter.service';
import { moscowClock, moscowDateParam } from '../reports/moscow-day';
import { OrderReportsService } from '../reports/order-reports.service';
import { REPORT, type TReportKey } from '../reports/report-status-map';
import { YandexClientFactory } from '../yandex-client.factory';
import { realSleep, type TSleep } from '../yandex-retry';

import { FBY_PROBLEM_INLINE_LIMIT, formatFbyOverview, type IFbyOverviewData } from './fby-message';
import { parseFbyStockReport } from './fby-stock-report';
import { buildFbyProblemWorkbook, fbyProblemFileName } from './fby-workbook';

/** Готовая xlsx-выгрузка проблемных позиций для отправки в Telegram. */
export interface IFbyExport {
  buffer: Buffer;
  filename: string;
}

/** Результат сборки экрана: текст и, при переполнении списка, файл. */
export interface IFbyOverviewResult {
  text: string;
  problemExport?: IFbyExport;
}

/** Заявки этих типов надо физически забрать со склада Маркета. */
const WITHDRAW_TYPES = ['WITHDRAW', 'UTILIZATION'];

/** Поллинг отчёта: интервал и потолок (генерация ~10 c, берём запас до ~50 c). */
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 20;

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
 */
@Injectable()
export class FbyService {
  private readonly sleep: TSleep = realSleep;

  constructor(
    private readonly clients: YandexClientFactory,
    private readonly reports: OrderReportsService,
    private readonly errors: ErrorReporter,
  ) {}

  public async build(
    store: YandexMarketDocument,
    now: Date = new Date(),
  ): Promise<IFbyOverviewResult> {
    const [stock, requests, inTransit, returning] = await Promise.all([
      this.safeStock(store),
      this.safeRequests(store),
      this.safeCount(store, REPORT.IN_TRANSIT),
      this.safeCount(store, REPORT.RETURNING),
    ]);

    const data: IFbyOverviewData = {
      stock: stock.summary,
      stockError: stock.error,
      requests,
      inTransit,
      returning,
    };

    const text = formatFbyOverview(data, now);

    // Файл строится ровно тогда, когда список проблемных не влезает в сообщение —
    // тот же порог, что и в тексте, поэтому «см. файл» и наличие файла совпадают.
    let problemExport: IFbyExport | undefined;
    if (stock.summary && stock.summary.problems.length > FBY_PROBLEM_INLINE_LIMIT) {
      const workbook = buildFbyProblemWorkbook(stock.summary.problems);
      problemExport = {
        buffer: workbook.buffer,
        filename: fbyProblemFileName(moscowDateParam(now), moscowClock(now)),
      };
    }

    return { text, problemExport };
  }

  /**
   * Остатки FBY по типам + проблемные позиции из отчёта stocks-on-warehouses
   * (generate → поллинг → скачивание → разбор). Единственный источник обоих.
   */
  private async safeStock(
    store: YandexMarketDocument,
  ): Promise<{ summary: IFbyStockSummary | null; error?: TFbyStockError }> {
    try {
      const client = this.clients.forStore(store);
      const reportId = await client.generateStocksOnWarehousesReport();
      const fileUrl = await this.pollReport(client, reportId);
      const buffer = await client.downloadReportFile(fileUrl);
      return { summary: parseFbyStockReport(buffer) };
    } catch (error) {
      const rateLimited = /rate limit|METHOD_FAILURE|1 point per 1 minute/i.test(
        error instanceof Error ? error.message : String(error),
      );
      // Лимит генерации 1/мин — это не поломка, а «подождите»: не спамим админов.
      if (!rateLimited) this.report(store, error, 'fby:stock', 'остатки FBY');
      return { summary: null, error: rateLimited ? 'rate_limit' : 'generic' };
    }
  }

  /** Ждём готовности отчёта. Бросает на FAILED и на исчерпании попыток. */
  private async pollReport(client: YandexApiClient, reportId: string): Promise<string> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      const info = await client.getReportInfo(reportId);
      if (info.status === 'DONE' && info.fileUrl) return info.fileUrl;
      if (info.status === 'FAILED') throw new Error('Отчёт об остатках FBY не сгенерировался');
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new Error('Отчёт об остатках FBY не готов вовремя');
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
