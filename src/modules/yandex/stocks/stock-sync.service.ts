import type { IPurchasePriceRow } from '../../../database/services/purchase-price.service';
import type { IYandexTenantCredentials, IStockUpdate } from '../yandex-api.client';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { STOCKS_BATCH_SIZE } from '../yandex-api.paths';
import { YandexClientFactory } from '../yandex-client.factory';

import { isStockWritable, placementOfCampaign } from './placement';
import { parsePriceList } from './price-list.parser';
import { resolveSku, stripBrand } from './sku-resolver';

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
  /**
   * Из сопоставленных — сколько уходит с остатком 0, то есть снимается с продажи.
   *
   * Считается отдельно и печатается в отчёте: в `stock.xlsx` приходит весь
   * ассортимент, и пустое количество означает «нет в наличии». Без этого числа
   * продавец видит «записано 5000» и не догадывается, что тысяча позиций ушла
   * в ноль.
   */
  zeroed: number;
  /** Фактически записано в Яндекс. */
  updated: number;
  /** Пропущено: нет в каталоге либо строка не разобрана. */
  skipped: ISkippedRow[];
  /** Разбивка по способу сопоставления — видно, что каталог неоднороден. */
  matchedBy: Record<string, number>;
  /** Батчи, которые Partner API отверг. */
  errors: Array<{ batch: number; skus: string[]; message: string }>;
  /** true — ничего не записывали, только сверяли. Это ПРОСЬБА продавца. */
  dryRun: boolean;
  catalogSize: number;
  /** Сколько закупочных цен сохранено в нашу базу. */
  purchasePricesSaved: number;
  /** Модель размещения подключённой кампании — как её вернул Маркет. */
  placementType?: string;
  /**
   * Почему запись пропущена. Отсутствует — писали (либо продавец просил сверку).
   *
   * РАЗРЯД, а не набор булевых. Поводов не писать стало три, итог у всех общий
   * («в Яндекс ничего не ушло»), а действия продавца — разные: сменить магазин,
   * прислать файл без пометки, или вообще ничего (запись выключена). Три флага
   * с общим итогом лишили бы отчёт возможности сказать, что именно произошло —
   * ровно поэтому `stockWriteForbidden` когда-то и отделили от `dryRun`.
   *
   * `dryRun` при этом остаётся ОТДЕЛЬНЫМ полем: это не отказ, а просьба.
   */
  writeSkipReason?: TWriteSkipReason;
}

/**
 * Повод не отправлять остатки в Partner API.
 *
 * - `placement` — модель магазина не даёт продавцу управлять остатками (FBY)
 *   либо её не удалось определить; какой из двух случаев, различает
 *   `placementType`;
 * - `write-disabled` — запись выключена настройкой среды
 *   (`STOCK_WRITE_ENABLED=false`), то есть решение развёртывания, а не магазина.
 */
export type TWriteSkipReason = 'placement' | 'write-disabled';

/**
 * Единственное место, где решается, писать ли остатки.
 *
 * Отдельной функцией, а не выражением на месте: порядок поводов значим
 * (настройка среды важнее модели — при выключенной записи модель даже не
 * спрашивается), а `no-nested-ternary` в этом проекте запрещён не зря.
 */
function skipReasonOf(writeEnabled: boolean, placementType?: string): TWriteSkipReason | undefined {
  if (!writeEnabled) return 'write-disabled';
  if (!isStockWritable(placementType)) return 'placement';
  return undefined;
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
    private readonly config: AppConfigService,
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

    /**
     * НАСТРОЙКА СРЕДЫ проверяется первой — раньше модели размещения.
     *
     * `STOCK_WRITE_ENABLED` объявляется каждым развёртыванием явно и без
     * умолчания: разработка идёт против боевого магазина (токен в `.env`
     * настоящий), и локальный запуск с присланным прайсом менял бы остатки
     * живого продавца — откатить это нечем, Яндекс не сообщает, что именно
     * применилось.
     *
     * Первой ещё и потому, что решение не зависит ни от чего внешнего: раз
     * писать всё равно не будем, незачем и спрашивать Маркет о модели.
     */
    const writeEnabled = this.config.stockWriteEnabled;

    /**
     * Модель размещения сервис выясняет САМ, а не принимает в опциях.
     *
     * Переданное вызывающим можно не передать — ровно так уже терялся `dryRun`.
     * Здесь цена ошибки выше: остатки ушли бы на склад Маркета. Один запрос
     * `GET v2/campaigns` против двадцати шести страниц каталога, которые будут
     * прочитаны следом, — незаметен.
     */
    const placementType = !writeEnabled
      ? undefined
      : await this.resolvePlacement(client, credentials.campaignId);

    const writeSkipReason = skipReasonOf(writeEnabled, placementType);

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
        // Решение заказчика: нет в каталоге — остаток просто не пишем. Это
        // новинки, которых ещё нет на Маркете, ронять из-за них загрузку незачем.
        skipped.push({
          name: row.name,
          category: row.category,
          rowNumber: row.rowNumber,
          reason: 'нет в каталоге Яндекса',
        });

        /**
         * А вот ЗАКУП сохраняем всё равно, под артикулом-кандидатом.
         *
         * Отсутствие в каталоге — довод против записи ОСТАТКА (неизвестный sku
         * даёт 400 на весь батч), но не против цены: цена лежит в нашей Mongo, а
         * заказ на позицию, которую продавец из каталога убрал, никуда не
         * исчезает. Именно так и терялись цены: за июль 6 из 7 артикулов без
         * закупа были в прайсе с ценой («Daniel Klein 14081-4» — 2280 ₽,
         * строка 16952), но выпадали здесь целиком вместе с остатком. В отчёте
         * это выглядело как «пришлите прайс с этими позициями», хотя они в
         * присланном прайсе были.
         *
         * Ключ — первый кандидат `stripBrand`: в позициях заказа приходит именно
         * голый код («14081-4»), и именно он совпал бы с каталогом, будь позиция
         * в нём. Коллизий это не создаёт: ключа нет в каталоге по условию ветки,
         * а между собой кандидаты «без бренда» на всех 19 143 наименованиях
         * файла уникальны (см. sku-resolver).
         */
        if (row.price !== null) {
          purchases.push({
            sku: stripBrand(row.name),
            price: row.price,
            name: row.name,
            category: row.category,
          });
        }

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
      zeroed: updates.filter((update) => update.count === 0).length,
      updated: 0,
      skipped,
      matchedBy,
      errors: [],
      dryRun,
      catalogSize: catalog.size,
      purchasePricesSaved: 0,
      placementType,
      writeSkipReason,
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

    /**
     * Запрошенная запись ПОНИЖАЕТСЯ до сверки, а не отвергается целиком.
     *
     * Разбор файла и закуп уже сделаны, и они полезны: закуп ложится в НАШУ базу
     * (см. комментарий выше), без него «Прибыль» у FBY-продавца не считалась бы
     * вовсе — а прайс у него единственный источник закупочных цен, потому что
     * `PurchasePrice` ключуется по продавцу, а не по магазину. Понижение
     * безопасно: «просили запись, сделали проверку» стоит времени, а обратное
     * направление стоило этому проекту бага, ради которого `sync` принимает
     * объект опций. Молчать при этом нельзя — `writeSkipReason` уходит в отчёт и
     * объясняется там текстом.
     */
    if (writeSkipReason) {
      this.logger.warn(
        writeSkipReason === 'write-disabled'
          ? 'Запись остатков пропущена: STOCK_WRITE_ENABLED=false'
          : `Запись остатков пропущена: модель «${placementType ?? 'неизвестна'}» ` +
              `не даёт продавцу управлять остатками (кампания ${credentials.campaignId})`,
      );
      return result;
    }

    result.updated = await this.writeInBatches(client, updates, result);
    return result;
  }

  /**
   * Модель размещения подключённой кампании — по живому ответу Маркета.
   *
   * Публичный: этим же ответом пользуется `stock-upload.handler`, чтобы выйти ДО
   * скачивания файла, когда кэш `YandexMarket.stores` модель не знает. Своего
   * запроса он не делает намеренно — правило и способ его выяснить должны
   * оставаться в одном месте, иначе они разойдутся.
   *
   * Не из кэша: тот мог устареть (кампанию перевели на другую модель), а
   * решение принимается о ЗАПИСИ.
   *
   * Сбой сети отдаёт `undefined`, то есть «нельзя писать»: невозможность
   * определить модель не должна превращаться в разрешение. Не бросает — на пути
   * `sync` файл всё равно будет разобран, а закуп сохранён.
   */
  public async placementFor(credentials: IYandexTenantCredentials): Promise<string | undefined> {
    return await this.resolvePlacement(this.clients.forTenant(credentials), credentials.campaignId);
  }

  private async resolvePlacement(
    client: ReturnType<YandexClientFactory['forTenant']>,
    campaignId: string,
  ): Promise<string | undefined> {
    try {
      return placementOfCampaign(await client.listStores(), campaignId);
    } catch (error) {
      this.logger.warn(`Не удалось определить модель размещения: ${String(error)}`);
      return undefined;
    }
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

    /**
     * ВТОРОЙ РУБЕЖ запрета записи — и по модели, и по среде.
     *
     * Проверка стоит вплотную к `updateStocks` — единственному вызову записи во
     * всём приложении, — а не только наверху `sync`: любой будущий путь сюда
     * (очередь, скрипт, админка) пройдёт мимо верхней проверки, но не мимо этой.
     * Тот же довод, по которому `accessGate` — это `bot.use`, а не проверка,
     * повторённая в каждом обработчике.
     *
     * Важно и то, что выход происходит ДО `getWarehouseId()`: на FBY-кампании он
     * возвращает склад МАРКЕТА (у живого продавца — 147 «Ростов-на-Дону-1»), и
     * даже узнавать его здесь незачем.
     */
    if (result.writeSkipReason) {
      this.logger.warn(
        `writeInBatches вызван при запрещённой записи (${result.writeSkipReason}) — ` +
          'остатки не отправлены',
      );
      return 0;
    }

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
