import type { IPurchasePriceRow } from '../../../database/services/purchase-price.service';
import type { IYandexTenantCredentials, IStockUpdate } from '../yandex-api.client';

import { Injectable, Logger } from '@nestjs/common';

import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { STOCKS_BATCH_SIZE } from '../yandex-api.paths';
import { YandexClientFactory } from '../yandex-client.factory';

import { parsePriceList } from './price-list.parser';
import { resolveSku } from './sku-resolver';

export interface ISkippedRow {
  name: string;
  category: string;
  rowNumber: number;
  reason: string;
}

export interface IStockSyncResult {
  /** Всего товарных строк в файле. */
  totalRows: number;
  /** Позиций, для которых артикул найден в каталоге. */
  matched: number;
  /** Фактически записано в Яндекс. */
  updated: number;
  /** Пропущено: нет в каталоге либо строка не разобрана. */
  skipped: ISkippedRow[];
  /** Разбивка по способу сопоставления — видно, что каталог неоднороден. */
  matchedBy: Record<string, number>;
  /** Батчи, которые Partner API отверг. */
  errors: Array<{ batch: number; skus: string[]; message: string }>;
  /** true — ничего не записывали, только сверяли. */
  dryRun: boolean;
  catalogSize: number;
  /** Сколько закупочных цен сохранено в нашу базу. */
  purchasePricesSaved: number;
}

/** Кому принадлежит прайс. Закуп скоупится по продавцу, как и всё остальное. */
export interface ISyncOptions {
  telegramUserId: string;
  /** Сверить с каталогом и составить отчёт, НИЧЕГО не записывая в Partner API. */
  dryRun?: boolean;
}

/**
 * Обновление остатков из прайс-листа.
 *
 * ЕДИНСТВЕННОЕ место во всём приложении, которое пишет в Partner API. Всё
 * остальное — отчёты — работает только на чтение.
 */
@Injectable()
export class StockSyncService {
  private readonly logger = new Logger(StockSyncService.name);

  constructor(
    private readonly clients: YandexClientFactory,
    private readonly purchasePrices: PurchasePriceService,
  ) {}

  /**
   * @param options.dryRun сверить с каталогом и составить отчёт, НИЧЕГО не
   *   записывая в Partner API. Нужен, чтобы увидеть последствия до того, как они
   *   наступят: сколько позиций найдётся, что пропустится. Первую загрузку
   *   разумно прогонять так.
   */
  public async sync(
    credentials: IYandexTenantCredentials,
    file: Buffer,
    options: ISyncOptions,
  ): Promise<IStockSyncResult> {
    /**
     * Проверка не формальность. Раньше третьим аргументом был флаг `dryRun`, и
     * забытый при переходе на объект `sync(creds, file, true)` дал бы
     * `dryRun: undefined` — то есть БОЕВУЮ запись остатков там, где просили
     * только сверку, плюс закуп, записанный в никуда. Компилятор ловит это в
     * `src`, но тесты в tsconfig не входят.
     */
    if (!options?.telegramUserId) {
      throw new Error('sync: нужен telegramUserId — закуп скоупится по продавцу');
    }

    const dryRun = options.dryRun ?? false;
    const client = this.clients.forTenant(credentials);

    const { rows, invalid } = parsePriceList(file);

    const skipped: ISkippedRow[] = invalid.map((row) => ({
      name: row.name,
      category: '(не разобрана)',
      rowNumber: row.rowNumber,
      reason: row.reason,
    }));

    // Каталог читаем ДО записи: без него непонятно, какие артикулы существуют,
    // а слать заведомо отсутствующие — это 400 на весь батч.
    const catalog = await client.loadCatalogOfferIds();

    const updates: IStockUpdate[] = [];
    const purchases: IPurchasePriceRow[] = [];
    const matchedBy: Record<string, number> = {};

    for (const row of rows) {
      const { sku, matchedBy: how } = resolveSku(row.name, catalog);

      if (!sku) {
        // Решение заказчика: нет в каталоге — просто пропускаем. Это новинки,
        // которых ещё нет на Маркете, ронять из-за них загрузку незачем.
        skipped.push({
          name: row.name,
          category: row.category,
          rowNumber: row.rowNumber,
          reason: 'нет в каталоге Яндекса',
        });
        continue;
      }

      matchedBy[how] = (matchedBy[how] ?? 0) + 1;
      updates.push({ sku, count: row.quantity });

      // Закупочная цена. Колонка «Цена» разбиралась и раньше, но никем не
      // читалась — именно из неё и считается прибыль. Ключ — разрешённый по
      // каталогу артикул: в позициях заказа приходит он же, и только по нему
      // закуп сходится с продажей.
      if (row.price !== null) {
        purchases.push({
          sku,
          price: row.price,
          name: row.name,
          category: row.category,
        });
      }
    }

    const result: IStockSyncResult = {
      totalRows: rows.length,
      matched: updates.length,
      updated: 0,
      skipped,
      matchedBy,
      errors: [],
      dryRun,
      catalogSize: catalog.size,
      purchasePricesSaved: 0,
    };

    /**
     * Закуп пишем ДО ветки dryRun и в том числе В НЕЙ.
     *
     * Это запись в НАШУ базу, а не в Partner API: режим «проверка» обещает не
     * менять ничего в магазине, и это обещание он держит. Зато прибыль начинает
     * считаться сразу после сверки — до первой боевой записи остатков, которую
     * на живом магазине разумно отложить.
     */
    result.purchasePricesSaved = await this.savePurchasePrices(options.telegramUserId, purchases);

    if (dryRun) {
      this.logger.log(`Сухой прогон: ${updates.length} из ${rows.length} нашлись, записи НЕ было`);
      return result;
    }

    result.updated = await this.writeInBatches(client, updates, result);
    return result;
  }

  /**
   * Сохранение закупа не должно ронять загрузку остатков.
   *
   * Остатки — то, ради чего файл и присылают; прибыль считается по ним же
   * позже. Упасть здесь значило бы не обновить остатки из-за проблемы с
   * второстепенными данными, поэтому ошибка логируется, а загрузка идёт дальше.
   */
  private async savePurchasePrices(
    telegramUserId: string,
    purchases: readonly IPurchasePriceRow[],
  ): Promise<number> {
    try {
      return await this.purchasePrices.upsertMany(telegramUserId, purchases);
    } catch (error) {
      this.logger.error(`Не удалось сохранить закупочные цены: ${String(error)}`);
      return 0;
    }
  }

  /**
   * Запись батчами. Отказ одного батча НЕ прерывает остальные: иначе ошибка на
   * первой сотне позиций оставила бы остальные четыре тысячи необновлёнными,
   * причём пользователь узнал бы об этом как о полном провале.
   */
  private async writeInBatches(
    client: ReturnType<YandexClientFactory['forTenant']>,
    updates: IStockUpdate[],
    result: IStockSyncResult,
  ): Promise<number> {
    if (!updates.length) return 0;

    const warehouseId = await client.getWarehouseId();
    let written = 0;

    for (let i = 0; i < updates.length; i += STOCKS_BATCH_SIZE) {
      const batch = updates.slice(i, i + STOCKS_BATCH_SIZE);
      const batchNumber = Math.floor(i / STOCKS_BATCH_SIZE) + 1;

      try {
        await client.updateStocks(batch, warehouseId);
        written += batch.length;
      } catch (error) {
        // Партию целиком считаем незаписанной: Яндекс не сообщает, какие
        // позиции внутри батча применились, а какие нет.
        result.errors.push({
          batch: batchNumber,
          skus: batch.map((b) => b.sku),
          message: error instanceof Error ? error.message : String(error),
        });
        this.logger.error(`Батч ${batchNumber} отвергнут: ${String(error)}`);
      }
    }

    return written;
  }
}
