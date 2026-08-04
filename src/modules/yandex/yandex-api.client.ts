import type { YandexApiError } from './yandex-api.errors';
import type { AxiosInstance, AxiosError } from 'axios';

import { Logger } from '@nestjs/common';
import axios from 'axios';

import { toYandexApiError } from './yandex-api.errors';
import {
  businessWarehousesPath,
  campaignsPath,
  fulfillmentWarehousesPath,
  offerMappingsPath,
  ordersPath,
  PAGE_LIMITS,
  reportInfoPath,
  returnsPath,
  stocksOnWarehousesGeneratePath,
  stocksPath,
  supplyRequestsPath,
  WAREHOUSE_PROBE_LIMIT,
} from './yandex-api.paths';
import { assertWithinHistoryWindow, toDateParam, type IDateRange } from './yandex-date-window';
import {
  DEFAULT_RETRY,
  realSleep,
  withRetry,
  type IRetryOptions,
  type TSleep,
} from './yandex-retry';

/** Креды КОНКРЕТНОГО продавца. Общих кредов у сервиса нет. */
export interface IYandexTenantCredentials {
  token: string;
  campaignId: string;
  businessId: string;
}

export interface IOrdersQuery {
  /** ISO 8601 со смещением — любое обновление заказа. */
  updatedAtFrom?: string;
  updatedAtTo?: string;
  /** DD-MM-YYYY — дата создания заказа. */
  fromDate?: string;
  toDate?: string;
  /** DD-MM-YYYY — дата ОТГРУЗКИ в службу доставки. Не путать с созданием. */
  supplierShipmentDateFrom?: string;
  supplierShipmentDateTo?: string;
  status?: string[];
  pageToken?: string;
  limit?: number;
}

/**
 * Возврат в терминах отчёта. Денежные поля — только актуальные:
 * `refundAmount` и `partnerCompensation` объявлены Яндексом устаревшими и
 * заменены объектами `amount` и `partnerCompensationAmount`. Старые поля до сих
 * пор приходят в ответе, поэтому прочитать их легко по привычке — и получить
 * сумму без валюты, которая когда-нибудь просто исчезнет.
 */
/** Ответ метода возвратов: полезная нагрузка бывает и в `result`, и на верхнем уровне. */
interface IReturnsPayload {
  returns?: unknown[];
  paging?: { nextPageToken?: string };
}

type IReturnsResponse = IReturnsPayload & { result?: IReturnsPayload };

export interface IReturnRecord {
  returnId?: number;
  orderId?: number;
  shipmentStatus?: string;
  /**
   * Когда возврат оформлен, ISO 8601 со смещением.
   *
   * Единственный способ показать «возвраты за месяц»: сам метод дат не
   * принимает, и период фильтруется у нас (см. collectReturns).
   */
  creationDate?: string;
  /** Сумма возврата: значение + валюта. */
  amount?: { value?: number; currencyId?: string };
  /** Компенсация партнёру. */
  partnerCompensationAmount?: { value?: number; currencyId?: string };
  raw: unknown;
}

export interface IReturnsQuery {
  /** Отбор возвратов по статусу отгрузки, например «в пути». */
  shipmentStatuses?: string[];
  pageToken?: string;
  limit?: number;
}

/**
 * Магазин продавца.
 *
 * Названия бизнеса и магазина храним ОТДЕЛЬНО: у одного бизнеса (кабинета)
 * может быть несколько магазинов, и при выборе продавцу показываются то одно,
 * то другое. Склеенная строка не позволила бы сгруппировать список.
 */
export interface IStoreRef {
  campaignId: string;
  businessId: string;
  /** Название кабинета — им подписан бизнес. */
  businessName: string;
  /** Домен магазина. Внутри одного кабинета магазины различаются им. */
  storeName: string;
  /**
   * Модель размещения кампании: FBS/FBY/DBS/Express. Нужна, чтобы различать
   * кампании в пикере: у одного бизнеса без домена все магазины сворачиваются
   * в одно название, и без пометки FBS/FBY выбор — лотерея.
   */
  placementType?: string;
}

/**
 * Склад в терминах обзора. `type` различает две принципиально разные модели:
 * `fby` — склад Маркета, товар хранит Яндекс; `store` — собственный склад
 * продавца, с которого он отгружает сам (FBS/DBS/Express).
 */
export interface IWarehouseInfo {
  id: number;
  name: string;
  type: 'fby' | 'store';
  /** Только для склада магазина: возможна ли экспресс-доставка. */
  express?: boolean;
  /** Только для склада магазина: имя группы, если склад в неё входит. */
  groupName?: string;
  /** Человекочитаемый адрес, если Маркет его вернул. */
  address?: string;
}

/** Обзор складов продавца по типам. */
export interface IWarehousesOverview {
  /** Склады Маркета (FBY). */
  fulfillment: IWarehouseInfo[];
  /** Склады магазина (FBS/DBS/Express). */
  store: IWarehouseInfo[];
}

/** Одна позиция для записи остатка. */
export interface IStockUpdate {
  /** Артикул в каталоге Яндекса (offerId). */
  sku: string;
  /** Остаток. 0 — валидное значение: означает «нет в наличии». */
  count: number;
}

/** Статус генерации асинхронного отчёта и ссылка на готовый файл. */
export interface IReportInfo {
  /** PENDING | PROCESSING | DONE | FAILED — приходит строкой, не валидируем жёстко. */
  status: string;
  /** Ссылка на файл — только когда status === DONE. */
  fileUrl?: string;
}

/**
 * Заявка FBY на вывоз/утилизацию в терминах сводки.
 *
 * `status`/`type`/`subtype` — сырые коды Маркета: на боевом их набор ШИРЕ, чем
 * enum в openapi (встречаются NEED_PREPARATION, WAREHOUSE_SIGNED_ACT и др.),
 * поэтому это строки, а подписи маппятся на стороне сообщения с fallback на код.
 */
export interface IFbySupplyRequest {
  /** Человекочитаемый номер заявки (marketplaceRequestId) — он виден в кабинете. */
  id: string;
  type: string;
  subtype?: string;
  status: string;
  /** Позиций с браком в заявке (counters.defectCount), 0 если не пришло. */
  defectCount: number;
  /** Всего позиций в заявке (counters.planCount), 0 если не пришло. */
  planCount: number;
  updatedAt?: string;
  /** Куда едет/откуда забирают — targetLocation.name. */
  targetName?: string;
}

export interface IPagedResult<T> {
  items: T[];
  nextPageToken?: string;
}

/** Настройки клиента, которые нужно уметь подменять в тестах. */
export interface IYandexClientOptions {
  timeoutMs?: number;
  retry?: IRetryOptions;
  sleep?: TSleep;
  /**
   * Предохранитель от бесконечной пагинации: битый nextPageToken, который
   * указывает сам на себя, иначе крутил бы запросы, пока не кончится квота.
   */
  maxPages?: number;
}

export const DEFAULT_MAX_PAGES = 200;

/**
 * Клиент Partner API одного продавца.
 *
 * СИНГЛТОНОМ БЫТЬ НЕ МОЖЕТ. Токен, campaignId и businessId принадлежат
 * конкретному продавцу, а сервис мультитенантный: общий клиент с изменяемым
 * заголовком означал бы, что при двух параллельных отчётах запрос одного
 * продавца уйдёт с токеном другого. Поэтому креды вмораживаются в экземпляр
 * при создании (см. YandexClientFactory) и снаружи не меняются — сеттера
 * токена здесь нет намеренно.
 */
export class YandexApiClient {
  private readonly logger = new Logger(YandexApiClient.name);
  private readonly http: AxiosInstance;

  private readonly retry: IRetryOptions;
  private readonly sleep: TSleep;
  private readonly maxPages: number;

  constructor(
    private readonly credentials: IYandexTenantCredentials,
    baseUrl: string,
    options: IYandexClientOptions = {},
  ) {
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.sleep = options.sleep ?? realSleep;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: options.timeoutMs ?? 30_000,
      // Массивы — повторяющимся параметром: `status=DELIVERED&status=CANCELLED`.
      // Это не косметика. Axios по умолчанию сериализует массив как
      // `status[]=DELIVERED`, и Partner API такой параметр молча ИГНОРИРУЕТ —
      // возвращая заказы во всех статусах. Отчёты этого не показывали только
      // потому, что `matchesReport` фильтрует ответ повторно у нас: за июль
      // приходило 946 заказов вместо 389, то есть 19 страниц вместо 8. Первая
      // страница при этом могла не содержать НИ ОДНОГО нужного заказа, так что
      // любой однострочный путь (getOrders без обхода) отдал бы пустой отчёт.
      paramsSerializer: { indexes: null },
      headers: {
        // Именно Api-Key. Authorization: Bearer, который ставил прежний
        // HttpClient и генерированный OpenAPI-клиент, Partner API не понимает.
        'Api-Key': credentials.token,
        'Content-Type': 'application/json',
      },
    });

    this.http.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => Promise.reject(this.toDomainError(error)),
    );
  }

  /** businessId нужен для истории глубже 30 дней — отдаём наружу read-only. */
  public get businessId(): string {
    return this.credentials.businessId;
  }

  public get campaignId(): string {
    return this.credentials.campaignId;
  }

  /**
   * ОДНА страница заказов. Для полного обхода есть iterateOrders — этот метод
   * оставлен публичным, потому что отчётам за сегодня одной страницы хватает,
   * а лишний запрос жжёт часовую квоту.
   */
  public async getOrders(query: IOrdersQuery = {}): Promise<IPagedResult<unknown>> {
    const limit = Math.min(query.limit ?? PAGE_LIMITS.orders.default, PAGE_LIMITS.orders.max);

    const data = await this.get<{ orders?: unknown[]; paging?: { nextPageToken?: string } }>(
      ordersPath(this.credentials.campaignId),
      {
        // page/pageSize объявлены deprecated — только pageToken.
        pageToken: query.pageToken,
        limit,
        updatedAtFrom: query.updatedAtFrom,
        updatedAtTo: query.updatedAtTo,
        fromDate: query.fromDate,
        toDate: query.toDate,
        supplierShipmentDateFrom: query.supplierShipmentDateFrom,
        supplierShipmentDateTo: query.supplierShipmentDateTo,
        status: query.status,
      },
    );

    return { items: data.orders ?? [], nextPageToken: data.paging?.nextPageToken };
  }

  /** Одна страница возвратов. */
  public async getReturns(query: IReturnsQuery = {}): Promise<IPagedResult<IReturnRecord>> {
    const limit = Math.min(query.limit ?? PAGE_LIMITS.returns.default, PAGE_LIMITS.returns.max);

    /**
     * ⚠️ Возвраты завёрнуты в `result`, а заказы — НЕТ. Форма ответа у Partner
     * API не единая:
     *
     *   GET .../orders  → { orders, paging }
     *   GET .../returns → { status, result: { returns, paging } }
     *
     * Пока читали `data.returns`, поле всегда было `undefined`, и метод молча
     * отдавал пустой список. Ошибки при этом не было ни одной: «возвратов нет»
     * — законный ответ, и отличить его от «мы не туда посмотрели» снаружи было
     * невозможно. Отчёт «Едет обратно» из-за этого показывал только невыкупы из
     * заказов, а собственно возвраты не показывал никогда.
     *
     * Читаем ОБА уровня: Яндекс уже расходится между методами, и полагаться на
     * то, что форма не поменяется, не на чем.
     */
    const data = await this.get<IReturnsResponse>(returnsPath(this.credentials.campaignId), {
      pageToken: query.pageToken,
      limit,
      shipmentStatuses: query.shipmentStatuses,
    });

    const payload = data?.result ?? data;

    // Пустой список возвратов — нормальный ответ, а не ошибка: у продавца
    // просто может не быть возвратов.
    return {
      items: (payload?.returns ?? []).map(toReturnRecord),
      nextPageToken: payload?.paging?.nextPageToken,
    };
  }

  /**
   * Постраничный обход заказов.
   *
   * Генератор, а не массив: продавец с тысячами заказов — это десятки страниц,
   * и держать их все в памяти незачем, потребителю нужна агрегация. Вызывающий
   * код решает сам, копить ли результат.
   */
  public async *iterateOrders(query: IOrdersQuery = {}): AsyncGenerator<unknown[], void, void> {
    let pageToken = query.pageToken;
    let pages = 0;

    do {
      const page = await this.getOrders({ ...query, pageToken });
      pages += 1;
      if (page.items.length) yield page.items;

      pageToken = page.nextPageToken;

      if (pageToken && pages >= this.maxPages) {
        // Молча оборвать обход — значит отдать неполный отчёт, выдав его за
        // полный. Про обрыв должно быть видно.
        this.logger.error(
          `Обход заказов прерван на ${pages} страницах (кампания ${this.credentials.campaignId}): ` +
            'достигнут предел страниц, отчёт неполный',
        );
        return;
      }
    } while (pageToken);
  }

  /** Постраничный обход возвратов. */
  public async *iterateReturns(
    query: IReturnsQuery = {},
  ): AsyncGenerator<IReturnRecord[], void, void> {
    let pageToken = query.pageToken;
    let pages = 0;

    do {
      const page = await this.getReturns({ ...query, pageToken });
      pages += 1;
      if (page.items.length) yield page.items;

      pageToken = page.nextPageToken;

      if (pageToken && pages >= this.maxPages) {
        this.logger.error(
          `Обход возвратов прерван на ${pages} страницах (кампания ${this.credentials.campaignId}): ` +
            'достигнут предел страниц, отчёт неполный',
        );
        return;
      }
    } while (pageToken);
  }

  /**
   * Заказы за период. Диапазон проверяется ДО отправки — не тратим квоту на
   * запрос, который Яндекс всё равно отклонит или отдаст пустым.
   */
  public async *iterateOrdersInRange(
    range: IDateRange,
    query: Omit<IOrdersQuery, 'fromDate' | 'toDate'> = {},
    now: Date = new Date(),
  ): AsyncGenerator<unknown[], void, void> {
    assertWithinHistoryWindow(range, now);

    yield* this.iterateOrders({
      ...query,
      fromDate: toDateParam(range.from),
      toDate: toDateParam(range.to),
    });
  }

  /** Список кампаний токена — самая дешёвая проверка, что кред живой. */
  public async getCampaigns(): Promise<unknown[]> {
    const data = await this.get<{ campaigns?: unknown[] }>(campaignsPath(), {});
    return data.campaigns ?? [];
  }

  /**
   * Магазины токена в готовом виде: и campaignId, и businessId сразу.
   *
   * Оба идентификатора приходят ОДНИМ запросом — значит искать их в кабинете
   * руками не нужно вовсе. Заодно это самая дешёвая проверка живости токена:
   * протухший отвалится здесь, на первом шаге онбординга, а не на первом
   * отчёте через неделю.
   */
  public async listStores(): Promise<IStoreRef[]> {
    const campaigns = await this.getCampaigns();

    return campaigns
      .map((raw): IStoreRef | null => {
        const c = (raw ?? {}) as {
          id?: number;
          domain?: string;
          placementType?: string;
          business?: { id?: number; name?: string };
        };
        if (!c.id || !c.business?.id) return null;
        const businessName = c.business.name ?? `Кабинет ${c.business.id}`;
        return {
          campaignId: String(c.id),
          businessId: String(c.business.id),
          businessName,
          // Домен — то, чем продавец различает свои магазины. Если его нет,
          // подписываем по названию кабинета, но НЕ оставляем пустым: кнопка
          // без подписи Telegram отвергает.
          storeName: c.domain ?? businessName,
          placementType: c.placementType,
        };
      })
      .filter((x): x is IStoreRef => x !== null);
  }

  /**
   * Полный обход каталога продавца. Возвращает артикулы (offerId) — именно с
   * ними сверяется прайс.
   *
   * Каталог реального магазина — 5.6k позиций, то есть 28 страниц. Держать всё
   * в памяти нормально: это строки, а не объекты товаров.
   */
  public async loadCatalogOfferIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let page = 0;

    do {
      const data = await this.post<{
        result?: {
          offerMappings?: Array<{ offer?: { offerId?: string } }>;
          paging?: { nextPageToken?: string };
        };
      }>(
        offerMappingsPath(this.credentials.businessId),
        { limit: PAGE_LIMITS.offerMappings.default, page_token: pageToken },
        {},
      );

      for (const m of data.result?.offerMappings ?? []) {
        if (m.offer?.offerId) ids.add(m.offer.offerId);
      }

      pageToken = data.result?.paging?.nextPageToken;
    } while (pageToken && ++page < this.maxPages);

    this.logger.log(`Каталог загружен: ${ids.size} артикулов`);
    return ids;
  }

  /**
   * ЗАПИСЬ остатков — единственная операция изменения во всём приложении.
   *
   * Один вызов = один батч. Разбиением на батчи и паузами занимается
   * вызывающий код: только он знает про общий объём и умеет собрать отчёт,
   * какие именно позиции не прошли.
   */
  public async updateStocks(items: IStockUpdate[], warehouseId: number): Promise<void> {
    if (!items.length) return;

    // Время отгрузки: Яндекс требует ISO 8601. Один момент на весь батч —
    // иначе позиции внутри одной загрузки получат разное время без причины.
    const updatedAt = new Date().toISOString();

    await this.put(stocksPath(this.credentials.campaignId), {
      skus: items.map((item) => ({
        sku: item.sku,
        warehouseId,
        items: [{ count: item.count, type: 'FIT', updatedAt }],
      })),
    });

    this.logger.log(`Остатки обновлены: ${items.length} позиций (склад ${warehouseId})`);
  }

  /**
   * Идентификатор склада ПРОДАВЦА — нужен для записи остатков.
   *
   * Склад сверяется со списком собственных складов бизнеса, а не берётся первым
   * из ответа. Ответ `offers/stocks` перечисляет склады, на которых лежит товар
   * кампании, и среди них бывает ЧУЖОЙ:
   *
   * - на FBY это склад Маркета (у живого продавца — 147 «Ростов-на-Дону-1»);
   *   писать туда нельзя, и это отсекается раньше правилом из `stocks/placement.ts`;
   * - на FBS в ответе может оказаться склад возвратов Маркета — документация
   *   `getStocks` описывает это прямо: «возврат поступил в указанную продавцом
   *   точку возвратов и долго не был забран». Правило по модели такой случай НЕ
   *   ловит: модель-то пишущая, чужой здесь конкретный склад.
   *
   * Раньше при `limit: 1` выбор зависел от того, какой склад Яндекс поставит
   * первым, — то есть остатки всего магазина могли уехать на склад возвратов.
   * Поэтому `limit` поднят, а решение принимается пересечением со списком
   * `GET v2/businesses/{id}/warehouses`.
   *
   * Пустое пересечение — ошибка, а не «возьмём первый»: писать наугад хуже, чем
   * не писать. Список складов бизнеса недоступен (сбой сети) — тоже ошибка, по
   * той же причине.
   */
  public async getWarehouseId(): Promise<number> {
    const [data, own] = await Promise.all([
      this.post<{
        result?: { warehouses?: Array<{ warehouseId?: number }> };
      }>(stocksPath(this.credentials.campaignId), { limit: WAREHOUSE_PROBE_LIMIT }, {}),
      this.listStoreWarehouses(),
    ]);

    const candidates = (data.result?.warehouses ?? [])
      .map((w) => w?.warehouseId)
      .filter((id): id is number => typeof id === 'number');

    if (!candidates.length) {
      throw new Error('Не удалось определить склад: Partner API не вернул warehouseId');
    }

    const ownIds = new Set(own.map((w) => w.id));
    const mine = candidates.find((id) => ownIds.has(id));

    if (mine === undefined) {
      throw new Error(
        `Не удалось определить склад магазина: в ответе только чужие склады ` +
          `(${candidates.join(', ')}), собственные — ${[...ownIds].join(', ') || 'не найдены'}`,
      );
    }

    if (mine !== candidates[0]) {
      // Первый склад в ответе оказался чужим — ровно тот случай, ради которого
      // сверка и появилась. В лог, чтобы это было видно, а не только «сработало».
      this.logger.warn(`Склад записи ${mine} выбран вместо чужого ${candidates[0]}`);
    }

    return mine;
  }

  /**
   * Обзор складов по типам: FBY (склад Маркета) и склады магазина.
   *
   * Оба запроса — GET и только чтение. Идут ОДНИМ Promise.all: это разные
   * методы разных разделов API, между собой не зависят, и ждать их
   * последовательно незачем. Пустой список у любого типа — нормальный ответ:
   * у продавца может не быть FBY вовсе, либо ни одного своего склада.
   */
  public async getWarehousesOverview(): Promise<IWarehousesOverview> {
    const [fulfillment, store] = await Promise.all([
      this.listFulfillmentWarehouses(),
      this.listStoreWarehouses(),
    ]);
    return { fulfillment, store };
  }

  /** Склады Маркета (FBY). */
  public async listFulfillmentWarehouses(): Promise<IWarehouseInfo[]> {
    const data = await this.get<{
      result?: { warehouses?: Array<{ id?: number; name?: string; address?: unknown }> };
    }>(fulfillmentWarehousesPath(), {});

    return (data.result?.warehouses ?? [])
      .filter(
        (w): w is { id: number; name?: string; address?: unknown } => typeof w?.id === 'number',
      )
      .map((w) => ({
        id: w.id,
        name: w.name ?? `Склад ${w.id}`,
        type: 'fby' as const,
        address: formatWarehouseAddress(w.address),
      }));
  }

  /**
   * Склады магазина (FBS/DBS/Express) и их группы.
   *
   * Склады, входящие в группу, приходят отдельным списком `warehouseGroups` и
   * в общий `warehouses` не дублируются — поэтому собираем оба, помечая
   * групповые именем группы.
   */
  public async listStoreWarehouses(): Promise<IWarehouseInfo[]> {
    const data = await this.get<{
      result?: {
        warehouses?: Array<TRawStoreWarehouse>;
        warehouseGroups?: Array<{ name?: string; warehouses?: Array<TRawStoreWarehouse> }>;
      };
    }>(businessWarehousesPath(this.credentials.businessId), {});

    const standalone = (data.result?.warehouses ?? []).map((w) => toStoreWarehouse(w));

    const grouped = (data.result?.warehouseGroups ?? []).flatMap((group) =>
      (group.warehouses ?? []).map((w) => toStoreWarehouse(w, group.name)),
    );

    return [...standalone, ...grouped].filter((w): w is IWarehouseInfo => w !== null);
  }

  /**
   * Запустить генерацию отчёта об остатках на складах (FBY) в формате CSV.
   *
   * Асинхронно: возвращает reportId, дальше статус и файл — через getReportInfo.
   * Формат CSV (а не FILE) выбран намеренно: FILE отдаёт декорированный xlsx с
   * шапкой и без строк данных, а CSV — чистую плоскую таблицу SKU×склад.
   *
   * Генерация лимитирована 1/мин на бизнес: при отказе Яндекс отвечает телом со
   * `status: ERROR` (без reportId) — бросаем ошибку с его текстом, чтобы блок
   * остатков деградировал с понятным сообщением, а не молча.
   */
  public async generateStocksOnWarehousesReport(): Promise<string> {
    const data = await this.post<{
      result?: { reportId?: string };
      errors?: Array<{ code?: string; message?: string }>;
    }>(
      stocksOnWarehousesGeneratePath(),
      { format: 'CSV' },
      {
        campaignId: Number(this.credentials.campaignId),
      },
    );

    const reportId = data.result?.reportId;
    if (!reportId) {
      const reason = data.errors?.[0]?.message ?? 'Partner API не вернул reportId';
      throw new Error(`Не удалось запустить отчёт об остатках: ${reason}`);
    }
    return reportId;
  }

  /** Статус готовности отчёта и ссылка на файл, когда он готов. */
  public async getReportInfo(reportId: string): Promise<IReportInfo> {
    const data = await this.get<{
      result?: { status?: string; file?: string };
    }>(reportInfoPath(reportId), {});

    return { status: data.result?.status ?? 'UNKNOWN', fileUrl: data.result?.file };
  }

  /**
   * Скачать готовый файл отчёта по ссылке из getReportInfo.
   *
   * Отдельным axios, а не через this.http: ссылка АБСОЛЮТНАЯ и на другой хост
   * (самоподписанный URL хранилища), Api-Key ей не нужен, а baseURL клиента
   * только помешал бы.
   */
  public async downloadReportFile(url: string): Promise<Buffer> {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 60_000,
    });
    return Buffer.from(response.data);
  }

  /**
   * Заявки FBY выбранных типов (для сводки — WITHDRAW+UTILIZATION).
   *
   * Полный обход страниц: пагинация — query `page_token`/`limit`, токен
   * следующей страницы в `result.paging.nextPageToken`. Тело несёт фильтр
   * `requestTypes`.
   */
  public async loadSupplyRequests(types: string[]): Promise<IFbySupplyRequest[]> {
    const out: IFbySupplyRequest[] = [];
    let pageToken: string | undefined;
    let page = 0;

    do {
      const data = await this.post<{
        result?: {
          requests?: Array<TRawSupplyRequest>;
          paging?: { nextPageToken?: string };
        };
      }>(
        supplyRequestsPath(this.credentials.campaignId),
        { page_token: pageToken, limit: 50 },
        { requestTypes: types },
      );

      for (const raw of data.result?.requests ?? []) {
        out.push(toSupplyRequest(raw));
      }

      pageToken = data.result?.paging?.nextPageToken;
    } while (pageToken && ++page < this.maxPages);

    return out;
  }

  private async get<T>(path: string, params: Record<string, unknown>): Promise<T> {
    // Логируем путь и кампанию, но НИКОГДА заголовки: там токен продавца.
    this.logger.debug(`GET ${path} (кампания ${this.credentials.campaignId})`);

    return await withRetry(
      async () => {
        const response = await this.http.get<T>(path, { params: prune(params) });
        return response.data;
      },
      this.retry,
      this.sleep,
      (error, attempt, delayMs) =>
        this.logger.warn(
          `Partner API ${error.status} на ${path}: повтор ${attempt}/${this.retry.attempts - 1} через ${delayMs} мс`,
        ),
    );
  }

  private async post<T>(path: string, params: Record<string, unknown>, body: unknown): Promise<T> {
    this.logger.debug(`POST ${path} (кампания ${this.credentials.campaignId})`);

    return await withRetry(
      async () => {
        const response = await this.http.post<T>(path, body, { params: prune(params) });
        return response.data;
      },
      this.retry,
      this.sleep,
      (error, attempt, delayMs) =>
        this.logger.warn(
          `Partner API ${error.status} на ${path}: повтор ${attempt}/${this.retry.attempts - 1} через ${delayMs} мс`,
        ),
    );
  }

  /**
   * PUT идёт БЕЗ повторов намеренно.
   *
   * withRetry повторяет запрос при 5xx и 420. Для чтения это безопасно, для
   * записи — нет: Яндекс мог применить изменение и не успеть ответить, и
   * повтор наложился бы поверх. Остатки — не идемпотентная операция в смысле
   * «повторить вслепую»: при ошибке лучше показать её в отчёте, чтобы
   * пользователь перезапустил загрузку осознанно.
   */
  private async put<T>(path: string, body: unknown): Promise<T> {
    this.logger.debug(`PUT ${path} (кампания ${this.credentials.campaignId})`);
    const response = await this.http.put<T>(path, body);
    return response.data;
  }

  private toDomainError(error: AxiosError): YandexApiError {
    const status = error.response?.status;
    // Метод и путь известны ТОЛЬКО здесь. Раньше они попадали лишь в текст
    // строки ниже, то есть на вопрос «на каком запросе упало» журнал ответить
    // не мог. Теперь они едут вместе с ошибкой.
    const domain = toYandexApiError(status, error.response?.data, error.message).withRequest(
      error.config?.method,
      error.config?.url,
    );

    this.logger.error(
      `Partner API ${status ?? 'нет ответа'} на ${error.config?.url} (кампания ${this.credentials.campaignId}): ${domain.message}`,
    );
    return domain;
  }
}

/**
 * Разбор одного возврата. Читаем ТОЛЬКО актуальные денежные поля: устаревшие
 * refundAmount и partnerCompensation Яндекс всё ещё присылает, но они без
 * валюты и однажды исчезнут. Сырой объект сохраняем — отчётам нужны и другие
 * поля, а перечислять их все здесь смысла нет.
 */
function toReturnRecord(raw: unknown): IReturnRecord {
  const item = (raw ?? {}) as IReturnRecord;
  return {
    returnId: item.returnId,
    orderId: item.orderId,
    shipmentStatus: item.shipmentStatus,
    creationDate: item.creationDate,
    amount: item.amount,
    partnerCompensationAmount: item.partnerCompensationAmount,
    raw,
  };
}

/** Сырая заявка FBY из ответа Partner API. */
type TRawSupplyRequest = {
  id?: { marketplaceRequestId?: string; id?: number };
  type?: string;
  subtype?: string;
  status?: string;
  counters?: { defectCount?: number; planCount?: number };
  updatedAt?: string;
  targetLocation?: { name?: string };
};

/**
 * Разбор одной заявки FBY. counters — ЧАСТИЧНЫЙ объект (на боевом у заявки
 * приходит лишь подмножество счётчиков), поэтому каждое поле опционально и
 * подстраховано нулём. id для показа — marketplaceRequestId (номер из кабинета),
 * а не внутренний числовой id.
 */
function toSupplyRequest(raw: TRawSupplyRequest): IFbySupplyRequest {
  const r = raw ?? {};
  return {
    id: r.id?.marketplaceRequestId ?? (r.id?.id != null ? String(r.id.id) : '—'),
    type: r.type ?? 'UNKNOWN',
    subtype: r.subtype,
    status: r.status ?? 'UNKNOWN',
    defectCount: Number(r.counters?.defectCount) || 0,
    planCount: Number(r.counters?.planCount) || 0,
    updatedAt: r.updatedAt,
    targetName: r.targetLocation?.name,
  };
}

/** Сырой склад магазина из ответа Partner API. */
type TRawStoreWarehouse = { id?: number; name?: string; express?: boolean; address?: unknown };

/** Один склад магазина в терминах обзора, либо null, если у него нет id. */
function toStoreWarehouse(raw: TRawStoreWarehouse, groupName?: string): IWarehouseInfo | null {
  if (typeof raw?.id !== 'number') return null;
  return {
    id: raw.id,
    name: raw.name ?? `Склад ${raw.id}`,
    type: 'store',
    express: !!raw.express,
    groupName,
    address: formatWarehouseAddress(raw.address),
  };
}

/**
 * Адрес склада одной строкой. Маркет присылает его разобранным на город/улицу/
 * дом; собираем непустые части через запятую. Возвращаем undefined, если не
 * пришло ничего, — в сообщении такая строка просто не печатается.
 */
function formatWarehouseAddress(address: unknown): string | undefined {
  const a = (address ?? {}) as {
    city?: string;
    street?: string;
    number?: string;
    building?: string;
    block?: string;
  };
  const parts = [a.city, a.street, a.number, a.building, a.block]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0);
  return parts.length ? parts.join(', ') : undefined;
}

/** undefined-параметры убираем: axios иначе шлёт `?limit=50&status=`. */
function prune(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  );
}
