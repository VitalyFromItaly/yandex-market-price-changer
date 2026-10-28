import type { IPurchasePriceRow } from '../../../database/services/purchase-price.service';
import type { IProductPriceRow } from '../../products/product.domain';
import type { IPurchaseRow } from '../reports/profit';
import type { IYandexTenantCredentials, IStockUpdate } from '../yandex-api.client';
import type { TWriteSkipReason } from './stock-upload-policy';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { CostHistoryService } from '../../../database/services/cost-history.service';
import { ProductService } from '../../../database/services/product.service';
import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { ErrorReporter } from '../../errors/error-reporter.service';
import {
  productRowsFromPriceList,
  productStockRowsFromPriceList,
} from '../../products/product.domain';
import { STOCKS_BATCH_SIZE } from '../yandex-api.paths';
import { YandexClientFactory } from '../yandex-client.factory';

import { placementOfCampaign } from './placement';
import { parsePriceList } from './price-list.parser';
import { resolveSku, stripBrand } from './sku-resolver';
import { skipReasonOf } from './stock-upload-policy';

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
  /**
   * true — закуп НЕ сохранялся, потому что фичу выключил администратор.
   * Отдельно от `purchasePricesSaved: 0`: ноль бывает и у файла без цен, а
   * отчёт обязан сказать, что именно произошло.
   */
  purchasePricesSkipped?: boolean;
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
  /**
   * true — остатки файл не пишет: их пишет план «Передачи остатков» на
   * «Прайсе» CRM (свой склад − продано после загрузки, по выбранным площадкам).
   * Не отказ и не проверка — третий режим, отсюда отдельное поле.
   */
  stocksByPlan?: boolean;
  /**
   * Товары с закупом из файла и сколько из них привязано к карточкам Ozon/WB:
   * закуп один на товар, площадка видит его через привязку. Нет — закуп не
   * сохранялся или подсчёт не удался (итог загрузки от этого не страдает).
   */
  purchaseCoverage?: { products: number; ozon: number; wb: number };
}

/**
 * Итог записи готовых остатков (`writeStocks`) — для путей, где остатки
 * посчитаны не из файла, а планом «Передачи остатков» (TASK-143).
 */
export interface IStockWriteResult {
  /** Фактически записано в Яндекс. */
  written: number;
  /** Батчи, которые Partner API отверг. */
  errors: IStockSyncResult['errors'];
  /** Почему не писали ничего. Отсутствует — запись была (или писать было нечего). */
  skipReason?: TWriteSkipReason;
  /** Модель кампании по живому ответу Маркета; undefined — не выяснена. */
  placementType?: string;
}

/** Повод не писать остатки — правило живёт в stock-upload-policy.ts, общее с ранним слоем. */
export type { TWriteSkipReason };

/** Кому принадлежит прайс. Закуп скоупится по продавцу, как и всё остальное. */
export interface ISyncOptions {
  telegramUserId: string;
  /** Сверить с каталогом и составить отчёт, НИЧЕГО не записывая в Partner API. */
  dryRun?: boolean;
  /**
   * Сохранять ли закупочные цены в нашу Mongo. По умолчанию да — умолчания
   * повторяют прежнее поведение, чтобы скрипт `load-purchase-prices` и старые
   * вызовы не изменились. `false` — админ закрыл продавцу фичу «закуп из
   * прайса».
   */
  savePurchasePrices?: boolean;
  /**
   * Разрешена ли продавцу запись остатков (фича «остатки из прайса»).
   * `false` понижает запись до сверки с `writeSkipReason: 'feature-disabled'`.
   */
  stockWriteAllowed?: boolean;
  /**
   * Остатки не писать вовсе — их запишет план «Передачи остатков» (CRM при
   * открытой `stock_push`): иначе в ЯМ было бы два писателя, и расписание плана
   * затирало бы сырые числа файла. Закуп и свой склад — как всегда.
   */
  stocksByPlan?: boolean;
}

/**
 * Обновление остатков из прайс-листа.
 *
 * Единственное место, которое пишет ОСТАТКИ в Partner API: из прайса (`sync`)
 * и из плана «Передачи остатков» (`writeStocks`, TASK-143) — оба через
 * `writeInBatches` с его последним рубежом.
 */
/** Что нужно `writeInBatches` от итога: повод не писать и куда класть отказы батчей. */
interface IWriteHolder {
  writeSkipReason?: TWriteSkipReason;
  errors: IStockSyncResult['errors'];
}

@Injectable()
export class StockSyncService {
  private readonly logger = new Logger(StockSyncService.name);

  constructor(
    private readonly clients: YandexClientFactory,
    private readonly purchasePrices: PurchasePriceService,
    private readonly config: AppConfigService,
    private readonly products: ProductService,
    private readonly errors: ErrorReporter,
    private readonly costHistory: CostHistoryService,
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
    const savePrices = options.savePurchasePrices ?? true;
    const stockWriteAllowed = options.stockWriteAllowed ?? true;
    const stocksByPlan = options.stocksByPlan ?? false;
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
    const placementType =
      !writeEnabled || !stockWriteAllowed || stocksByPlan
        ? undefined
        : await this.resolvePlacement(client, credentials.campaignId);

    // Режим плана: писать отсюда не будем, поводов «почему не записали» нет.
    const writeSkipReason = stocksByPlan
      ? undefined
      : skipReasonOf(writeEnabled, stockWriteAllowed, placementType);

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
    // Свой склад (TASK-142): количество каждой разобранной строки, под тем же
    // ключом, что закуп. Пишется в Product независимо от записи на Маркет.
    const ownStock: { sku: string; quantity: number }[] = [];
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
        ownStock.push({ sku: stripBrand(row.name), quantity: row.quantity });
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
      ownStock.push({ sku, quantity: row.quantity });

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
      ...(stocksByPlan ? { stocksByPlan: true } : {}),
    };

    /**
     * Закуп пишем ДО ветки dryRun и в том числе В НЕЙ.
     *
     * Это запись в НАШУ базу, а не в Partner API: режим «проверка» обещает не
     * менять ничего в магазине, и это обещание он держит. Зато прибыль начинает
     * считаться сразу после сверки — до первой боевой записи остатков, которую
     * на живом магазине разумно отложить.
     *
     * Исключение одно — фича «закуп из прайса» выключена администратором; тогда
     * `purchasePricesSkipped` объясняет в отчёте, почему сохранённых цен ноль.
     */
    if (savePrices) {
      result.purchasePricesSaved = await this.savePurchasePrices(options.telegramUserId, purchases);
      if (result.purchasePricesSaved) {
        const coverage = await this.purchaseCoverage(options.telegramUserId, purchases);
        if (coverage) result.purchaseCoverage = coverage;
      }
    } else {
      result.purchasePricesSkipped = true;
    }

    // После закупа: новый товар заводит он, остаток ложится в уже заведённый.
    // Это наша Mongo, поэтому и в «проверке» — как закуп.
    await this.saveOwnStock(options.telegramUserId, ownStock);

    if (dryRun) {
      this.logger.log(`Сухой прогон: ${updates.length} из ${rows.length} нашлись, записи НЕ было`);
      return result;
    }

    if (stocksByPlan) {
      this.logger.log(`Прайс для плана: свой склад сохранён, остатки пишет «Передача остатков»`);
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
      this.logger.warn(this.skipLogLine(writeSkipReason, placementType, credentials.campaignId));
      return result;
    }

    result.updated = await this.writeInBatches(client, updates, result);
    return result;
  }

  /**
   * Запись УЖЕ посчитанных остатков на склад продавца кампании (TASK-143).
   *
   * Второй путь к `writeInBatches`, и барьеры он проходит те же, а не свои:
   * `STOCK_WRITE_ENABLED` и модель по ЖИВОМУ `listStores()` выясняются здесь
   * же, не принимаются от вызывающего (довод `sync`: переданное можно не
   * передать). Последний рубеж — внутри `writeInBatches`, вплотную к
   * `updateStocks`. Фичу продавца проверяет вызывающий: у сервиса нет доступа
   * к `UserAccess`, и это ровно довод `stockWriteAllowed`.
   */
  public async writeStocks(
    credentials: IYandexTenantCredentials,
    updates: readonly IStockUpdate[],
    options: { telegramUserId: string },
  ): Promise<IStockWriteResult> {
    if (!options?.telegramUserId) {
      throw new Error('writeStocks: нужен telegramUserId — запись журналируется по продавцу');
    }
    const client = this.clients.forTenant(credentials);
    const writeEnabled = this.config.stockWriteEnabled;
    const placementType = writeEnabled
      ? await this.resolvePlacement(client, credentials.campaignId)
      : undefined;
    const skipReason = skipReasonOf(writeEnabled, true, placementType);
    const holder: IWriteHolder = { writeSkipReason: skipReason, errors: [] };

    if (skipReason) {
      this.logger.warn(this.skipLogLine(skipReason, placementType, credentials.campaignId));
      return { written: 0, errors: [], skipReason, placementType };
    }

    const written = await this.writeInBatches(client, [...updates], holder);
    return { written, errors: holder.errors, placementType };
  }

  /** Строка лога о пропущенной записи — по одному предложению на каждый повод. */
  private skipLogLine(
    reason: TWriteSkipReason,
    placementType: string | undefined,
    campaignId: string,
  ): string {
    if (reason === 'write-disabled') return 'Запись остатков пропущена: STOCK_WRITE_ENABLED=false';
    if (reason === 'feature-disabled') {
      return 'Запись остатков пропущена: фича «остатки из прайса» выключена администратором';
    }
    return (
      `Запись остатков пропущена: модель «${placementType ?? 'неизвестна'}» ` +
      `не даёт продавцу управлять остатками (кампания ${campaignId})`
    );
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
    let saved: number;
    let previous: Map<string, IPurchaseRow>;
    try {
      // Закуп ДО записи — материал стартовой записи истории себестоимости: после
      // upsert старой цены уже не прочитать, а без неё новая стала бы стартовой
      // и переписала прошлые месяцы.
      previous = await this.purchasePrices.findBySkus(
        telegramUserId,
        purchases.map((row) => row.sku),
      );
      saved = await this.purchasePrices.upsertMany(telegramUserId, purchases);
    } catch (error) {
      this.logger.error(`Не удалось сохранить закупочные цены: ${String(error)}`);
      return 0;
    }

    const rows = productRowsFromPriceList(purchases);
    await this.saveProducts(telegramUserId, rows);
    await this.saveCostHistory(telegramUserId, rows, previous);
    return saved;
  }

  /** Подсчёт для итога — сбой не роняет загрузку: закуп уже сохранён. */
  private async purchaseCoverage(
    telegramUserId: string,
    purchases: readonly IPurchasePriceRow[],
  ): Promise<IStockSyncResult['purchaseCoverage'] | undefined> {
    try {
      return await this.products.purchaseCoverage(
        telegramUserId,
        purchases.map((row) => row.sku),
      );
    } catch (error) {
      this.logger.warn(`Не удалось посчитать привязки закупа: ${String(error)}`);
      return undefined;
    }
  }

  /**
   * История себестоимости (TASK-116): запись только при изменении цены, после
   * товаров — история принадлежит товару, и новому товару нужен его id.
   *
   * Сбой не роняет загрузку, но и не глотается. Цена в `PurchasePrice` к этому
   * моменту уже новая, так что у товара без истории она станет стартовой — то
   * есть прошлое пересчитается, как до TASK-116 (known-gaps).
   */
  private async saveCostHistory(
    telegramUserId: string,
    rows: readonly IProductPriceRow[],
    previous: ReadonlyMap<string, IPurchaseRow>,
  ): Promise<void> {
    try {
      await this.costHistory.recordPriceList(telegramUserId, rows, previous);
    } catch (error) {
      this.logger.error(`Не удалось записать историю себестоимости: ${String(error)}`);
      void this.errors.report({
        error,
        source: 'queue',
        context: 'products:cost-history',
        telegramUserId,
      });
    }
  }

  /**
   * Тот же закуп — в базу товаров (`Product`), сразу за `PurchasePrice`
   * (решение `product_sync_on_price_upload`): иначе Product устарел бы с первого
   * же нового прайса. Только после успешной записи закупа — товары не должны
   * знать цену, которой нет у «Прибыли».
   *
   * Сбой НЕ роняет загрузку (остатки и закуп уже записаны) и не глотается:
   * уходит в журнал ошибок; товары догоняются `scripts/seed-products.ts`.
   */
  private async saveProducts(
    telegramUserId: string,
    rows: readonly IProductPriceRow[],
  ): Promise<void> {
    try {
      await this.products.upsertFromPriceList(telegramUserId, rows);
    } catch (error) {
      this.logger.error(`Не удалось обновить товары из прайса: ${String(error)}`);
      void this.errors.report({
        error,
        source: 'queue',
        context: 'products:price-list',
        telegramUserId,
      });
    }
  }

  /**
   * Свой склад товаров из прайса (раздел «Склад», TASK-142). Сбой не роняет
   * загрузку — остатки Маркета и закуп важнее, — но уходит в журнал ошибок.
   */
  private async saveOwnStock(
    telegramUserId: string,
    rows: readonly { sku: string; quantity: number }[],
  ): Promise<void> {
    try {
      await this.products.setStockFromPriceList(
        telegramUserId,
        productStockRowsFromPriceList(rows),
      );
    } catch (error) {
      this.logger.error(`Не удалось записать свой склад товаров: ${String(error)}`);
      void this.errors.report({
        error,
        source: 'queue',
        context: 'products:own-stock',
        telegramUserId,
      });
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
    result: IWriteHolder,
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

    /**
     * Отрицательный или нечисловой остаток не уходит никуда: такой PUT Маркет
     * либо отвергнет батчем, либо — хуже — примет как ноль. Отказ целиком, а
     * не пропуск строки: число из ниоткуда значит, что сломан расчёт выше.
     */
    const broken = updates.find((u) => !Number.isFinite(u.count) || u.count < 0);
    if (broken) {
      throw new Error(
        `Остаток «${broken.sku}» = ${broken.count}: запись остатков отменена целиком`,
      );
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
