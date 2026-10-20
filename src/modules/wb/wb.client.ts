import { Logger } from '@nestjs/common';
import axios, { type AxiosError, type AxiosInstance } from 'axios';

import { type IRetryOptions, type TSleep, realSleep } from '../yandex/yandex-retry';

import { WB_RETRY, withWbRetry } from './wb-retry';
import { type WbApiError, WbIncompleteResponseError, toWbApiError } from './wb.errors';

/**
 * HTTP-клиент WB API.
 *
 * У WB нет одного адреса: каждая категория API живёт на своём хосте
 * (`content-api`, `statistics-api`…), и токен открывает только выбранные при
 * выпуске категории. Поэтому клиент ходит полными адресами, а хосты — таблица
 * `WB_CATEGORY_HOSTS`. Все десять хостов с `/ping` сверены живыми запросами
 * 18-10-2026 (без токена каждый отвечает 401, а не 404). Документация
 * dev.wildberries.ru автоматические запросы не пускает (HTTP 498).
 *
 * Авторизация — заголовок `Authorization: <токен>` без `Bearer`. Токен живёт
 * только в заголовках экземпляра axios: в логи идут метод, адрес, статус и
 * requestId — никогда `config.headers`. `proxy: false` — довод клиента Ozon.
 */

export const WB_TIMEOUT_MS = 20_000;

/** Категории API, к которым токен WB выдаёт доступ (раздел «Доступ к API» кабинета). */
export type TWbCategory =
  | 'content'
  | 'analytics'
  | 'prices'
  | 'marketplace'
  | 'statistics'
  | 'promotion'
  | 'feedbacks'
  | 'finance'
  | 'documents';

export const WB_CATEGORY_HOSTS: Record<TWbCategory, string> = {
  content: 'https://content-api.wildberries.ru',
  analytics: 'https://seller-analytics-api.wildberries.ru',
  prices: 'https://discounts-prices-api.wildberries.ru',
  marketplace: 'https://marketplace-api.wildberries.ru',
  statistics: 'https://statistics-api.wildberries.ru',
  promotion: 'https://advert-api.wildberries.ru',
  feedbacks: 'https://feedbacks-api.wildberries.ru',
  finance: 'https://finance-api.wildberries.ru',
  documents: 'https://documents-api.wildberries.ru',
};

/** Общие методы (тарифы, новости, данные продавца) — на любой токен. */
export const WB_COMMON_HOST = 'https://common-api.wildberries.ru';

export const WB_PATHS = {
  /** Проверка подключения: токен действует и открывает категорию этого хоста. */
  ping: '/ping',
  /** Данные продавца, которому принадлежит токен: название, sid, торговая марка. */
  sellerInfo: '/api/v1/seller-info',
  /** Карточки товаров продавца, курсор `{updatedAt, nmID}` («Контент»). */
  cardsList: '/content/v2/get/cards/list',
  /** Остатки на складах WB (FBW) — полный снимок от `dateFrom` («Статистика», 1 запрос/мин). */
  supplierStocks: '/api/v1/supplier/stocks',
  /** Склады продавца (FBS) — «Маркетплейс». */
  warehouses: '/api/v3/warehouses',
  /**
   * Остатки склада продавца по штрихкодам: POST — только чтение; PUT — ЗАПИСЬ
   * (TASK-175, без повторов, `{stocks: [{sku: штрихкод, amount}]}`).
   */
  sellerStocks: (warehouseId: string) => `/api/v3/stocks/${encodeURIComponent(warehouseId)}`,
  /** Заказы (FBW и FBS): строки, изменившиеся с `dateFrom`, по `lastChangeDate` («Статистика»). */
  supplierOrders: '/api/v1/supplier/orders',
  /** Выкупы (`saleID` S…) и возвраты (R…) — тот же обход по `lastChangeDate` («Статистика»). */
  supplierSales: '/api/v1/supplier/sales',
  /** Сборочные задания FBS за интервал ≤ 30 дней, курсор `next` («Маркетплейс»). */
  fbsOrders: '/api/v3/orders',
  /** Статусы сборочных заданий по id — POST, но только чтение («Маркетплейс»). */
  fbsOrderStatuses: '/api/v3/orders/status',
  /**
   * Отчёт реализации — строки еженедельных отчётов за период, курсор `rrdid`
   * («Статистика», тот же лимит 1 запрос в минуту). Путь — по памяти: доки
   * WB автоматике не отдаются (known-gaps).
   */
  reportDetail: '/api/v5/supplier/reportDetailByPeriod',
} as const;

/** Страница карточек: больше WB не отдаёт. */
export const WB_CARDS_LIMIT = 100;
/** Штрихкодов в одном запросе остатков склада продавца. */
export const WB_STOCKS_BATCH = 1000;
/** Потолок страниц обхода карточек: 100 × 1000 = 100 тыс. карточек. */
export const WB_MAX_PAGES = 1000;
/**
 * `dateFrom` для остатков FBW: метод отдаёт строки, изменившиеся с этой даты,
 * поэтому полный снимок — с даты раньше любой карточки (пример из документации WB).
 */
export const WB_STOCKS_SINCE = '2019-06-20';
/**
 * Лимит «Статистики» — 1 запрос в минуту на продавца. `withWbRetry` паузы
 * длиннее 30 с не ждёт, поэтому клиент выдерживает интервал сам перед каждым
 * вызовом статистики, кроме первого: иначе вторая страница или выкупы после
 * заказов упали бы в 429.
 */
export const WB_STATISTICS_INTERVAL_MS = 61_000;
/** Строк в одном ответе orders/sales статистики — больше WB не отдаёт. */
export const WB_STATISTICS_PAGE_ROWS = 80_000;
/** Потолок страниц статистики: при 80 тыс. строк это миллионы строк — дальше только круг. */
export const WB_STATISTICS_MAX_PAGES = 50;
/** Строк в одном ответе отчёта реализации — больше WB не отдаёт. */
export const WB_REPORT_DETAIL_LIMIT = 100_000;
/** Страница сборочных заданий FBS и батч запроса их статусов. */
export const WB_FBS_ORDERS_LIMIT = 1000;

export interface IWbClientOptions {
  retry?: IRetryOptions;
  sleep?: TSleep;
  timeoutMs?: number;
}

export interface IWbSellerInfo {
  name: string;
  /** Идентификатор продавца WB — на экраны не выводится, как id кабинетов. */
  sid: string;
  tradeMark: string;
}

/** Размер карточки: у WB штрихкоды висят на размерах, а не на карточке. */
export interface IWbCardSize {
  chrtID: string;
  barcodes: string[];
}

/** Карточка WB. `vendorCode` — артикул продавца, `nmID` — номер WB (его несут заказы и отчёты). */
export interface IWbCard {
  nmID: string;
  vendorCode: string;
  title?: string;
  brand?: string;
  sizes: IWbCardSize[];
}

/** Строка остатков на складе WB (FBW): одна на артикул × размер × склад. */
export interface IWbStockRow {
  supplierArticle: string;
  nmId: string;
  barcode: string;
  warehouseName: string;
  /** Доступно к продаже. */
  quantity: number;
}

/** Склад продавца (FBS). */
export interface IWbWarehouse {
  id: string;
  name: string;
  /**
   * Тип доставки склада: 1 — FBS (WB забирает со склада продавца), 2 — DBS и
   * другие — доставка продавцом. Нет поля или мусор — null (неизвестное =
   * не пишется, TASK-175). Значения по памяти — known-gaps.
   */
  deliveryType: number | null;
}

/** Тип доставки склада FBS в /api/v3/warehouses. */
export const WB_DELIVERY_TYPE_FBS = 1;

/** Позиция записи остатка склада продавца: штрихкод и количество. */
export interface IWbStockWrite {
  barcode: string;
  amount: number;
}

/** Остаток склада продавца по штрихкоду. */
export interface IWbSellerStock {
  barcode: string;
  amount: number;
}

/** Строка заказа «Статистики»: одна штука товара, ключ — `srid`. */
export interface IWbOrderRow {
  srid: string;
  /** Корзина покупателя: заказ из нескольких штук — несколько строк с одним `gNumber`. */
  gNumber: string;
  /** Момент заказа по Москве без смещения. */
  date: string;
  lastChangeDate: string;
  supplierArticle: string;
  nmId: string;
  subject: string;
  /** «Склад WB» (FBW) или «Склад продавца» (FBS). */
  warehouseType: string;
  /** Цена продавца со скидкой продавца, до СПП WB; null — не пришла. */
  priceWithDisc: number | null;
  isCancel: boolean;
}

/** Строка продаж «Статистики»: `saleID` S… — выкуп, R… — возврат. */
export interface IWbSaleRow {
  srid: string;
  saleID: string;
  lastChangeDate: string;
}

/** Сборочное задание FBS. `rid` — тот же `srid`, что в статистике. */
export interface IWbFbsOrder {
  id: string;
  rid: string;
  createdAt: string;
  article: string;
  nmId: string;
  /** Цена в рублях из `convertedPrice` (копейки) при валюте 643; иначе null. */
  price: number | null;
}

/** Статус сборочного задания: свой (`supplierStatus`) и WB (`wbStatus`). */
export interface IWbFbsOrderStatus {
  id: string;
  supplierStatus: string;
  wbStatus: string;
}

export class WbClient {
  private readonly logger = new Logger(WbClient.name);
  private readonly http: AxiosInstance;
  private readonly retry: IRetryOptions;
  private readonly sleep: TSleep;
  /** Был ли уже вызов «Статистики» этим клиентом — следующий ждёт интервал. */
  private statisticsCalled = false;

  constructor(token: string, options: IWbClientOptions = {}) {
    this.retry = options.retry ?? WB_RETRY;
    this.sleep = options.sleep ?? realSleep;

    this.http = axios.create({
      timeout: options.timeoutMs ?? WB_TIMEOUT_MS,
      proxy: false,
      headers: { Authorization: token },
    });

    this.http.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => Promise.reject(this.toDomainError(error)),
    );
  }

  /** `GET <хост категории>/ping`. Бросает WbAuthError, если категория токену закрыта. */
  public async ping(category: TWbCategory): Promise<void> {
    await this.call(() => this.http.get(`${WB_CATEGORY_HOSTS[category]}${WB_PATHS.ping}`));
  }

  /** Продавец токена. Мусор в ответе — пустые строки, а не падение. */
  public async sellerInfo(): Promise<IWbSellerInfo> {
    return mapSellerInfo(
      await this.call(() => this.http.get(`${WB_COMMON_HOST}${WB_PATHS.sellerInfo}`)),
    );
  }

  /**
   * Все карточки продавца — курсор `{updatedAt, nmID}` до неполной страницы.
   * Повтор курсора останавливает обход: на нём он ходил бы по кругу.
   */
  public async listCards(): Promise<IWbCard[]> {
    const cards: IWbCard[] = [];
    let cursor: { updatedAt?: string; nmID?: number } = {};
    for (let page = 0; page < WB_MAX_PAGES; page += 1) {
      const body = {
        settings: { cursor: { limit: WB_CARDS_LIMIT, ...cursor }, filter: { withPhoto: -1 } },
      };
      const result = mapCards(
        await this.call(() =>
          this.http.post(`${WB_CATEGORY_HOSTS.content}${WB_PATHS.cardsList}`, body),
        ),
      );
      cards.push(...result.cards);
      const next = result.cursor;
      const repeated = next.updatedAt === cursor.updatedAt && next.nmID === cursor.nmID;
      if (!result.cards.length || result.total < WB_CARDS_LIMIT || !next.updatedAt || repeated) {
        break;
      }
      cursor = { updatedAt: next.updatedAt, nmID: next.nmID };
    }
    return cards;
  }

  /** Остатки на складах WB (FBW). Только чтение. */
  public async loadWbStocks(): Promise<IWbStockRow[]> {
    return mapWbStocks(
      await this.statistics(WB_PATHS.supplierStocks, { dateFrom: WB_STOCKS_SINCE }),
    );
  }

  /** Заказы, изменившиеся с `dateFrom` (`ГГГГ-ММ-ДД` по Москве). Только чтение. */
  public async listSupplierOrders(dateFrom: string): Promise<IWbOrderRow[]> {
    return this.statisticsPages(WB_PATHS.supplierOrders, dateFrom, mapWbOrders);
  }

  /** Выкупы и возвраты, изменившиеся с `dateFrom`. Только чтение. */
  public async listSupplierSales(dateFrom: string): Promise<IWbSaleRow[]> {
    return this.statisticsPages(WB_PATHS.supplierSales, dateFrom, mapWbSales);
  }

  /**
   * Строки отчёта реализации за `dateFrom`…`dateTo` (`ГГГГ-ММ-ДД` по Москве),
   * еженедельные отчёты. Курсор — `rrd_id` последней строки (`rrdid`), стоп
   * на пустом ответе. Неполное — `WbIncompleteResponseError`, а не тихий стоп:
   * недосчитанная неделя легла бы в журнал как настоящая. Только чтение.
   */
  public async listRealizationReport(dateFrom: string, dateTo: string): Promise<TRaw[]> {
    const rows: TRaw[] = [];
    let rrdid = '0';
    for (let page = 0; page < WB_STATISTICS_MAX_PAGES; page += 1) {
      const result = mapWbRealization(
        await this.statistics(WB_PATHS.reportDetail, {
          dateFrom,
          dateTo,
          limit: WB_REPORT_DETAIL_LIMIT,
          rrdid,
          period: 'weekly',
        }),
      );
      rows.push(...result.rows);
      const last = result.lastRrdId;
      if (!result.count) return rows;
      // Страница без продвижения курсора: следующий запрос вернул бы её же.
      if (!last || BigInt(last) <= BigInt(rrdid)) {
        throw new WbIncompleteResponseError(
          `${WB_PATHS.reportDetail}: курсор rrd_id не сдвинулся с ${rrdid} — отчёт не получить целиком`,
          'отчёт реализации',
        );
      }
      rrdid = last;
    }
    throw new WbIncompleteResponseError(
      `${WB_PATHS.reportDetail}: после ${WB_STATISTICS_MAX_PAGES} страниц строки не кончились`,
      'отчёт реализации',
    );
  }

  /** Сборочные задания FBS за интервал (≤ 30 дней) — курсор `next` до неполной страницы. */
  public async listFbsOrders(since: Date, to: Date): Promise<IWbFbsOrder[]> {
    const url = `${WB_CATEGORY_HOSTS.marketplace}${WB_PATHS.fbsOrders}`;
    const orders: IWbFbsOrder[] = [];
    let next = 0;
    for (let page = 0; page < WB_MAX_PAGES; page += 1) {
      const params = {
        limit: WB_FBS_ORDERS_LIMIT,
        next,
        dateFrom: Math.floor(since.getTime() / 1000),
        dateTo: Math.floor(to.getTime() / 1000),
      };
      const result = mapFbsOrders(await this.call(() => this.http.get(url, { params })));
      orders.push(...result.orders);
      // Повтор курсора — круг; ноль — конец.
      if (result.count < WB_FBS_ORDERS_LIMIT || !result.next || result.next === next) break;
      next = result.next;
    }
    return orders;
  }

  /** Статусы сборочных заданий батчами по `WB_FBS_ORDERS_LIMIT`. Только чтение. */
  public async fbsOrderStatuses(ids: readonly string[]): Promise<IWbFbsOrderStatus[]> {
    const url = `${WB_CATEGORY_HOSTS.marketplace}${WB_PATHS.fbsOrderStatuses}`;
    const statuses: IWbFbsOrderStatus[] = [];
    for (let i = 0; i < ids.length; i += WB_FBS_ORDERS_LIMIT) {
      const body = { orders: ids.slice(i, i + WB_FBS_ORDERS_LIMIT).map(Number) };
      statuses.push(...mapFbsOrderStatuses(await this.call(() => this.http.post(url, body))));
    }
    return statuses;
  }

  /**
   * Обход orders/sales «Статистики» по `lastChangeDate`: следующая страница —
   * с `lastChangeDate` последней строки (`flag=0` — «изменённые с даты»).
   * Стоп на неполной странице и на повторе даты — иначе круг; строки стыка
   * приходят дважды, дубли вызывающий схлопывает по `srid`.
   */
  private async statisticsPages<T extends { lastChangeDate: string }>(
    path: string,
    dateFrom: string,
    map: (raw: unknown) => { rows: T[]; count: number },
  ): Promise<T[]> {
    const rows: T[] = [];
    let from = dateFrom;
    for (let page = 0; page < WB_STATISTICS_MAX_PAGES; page += 1) {
      const result = map(await this.statistics(path, { dateFrom: from, flag: 0 }));
      rows.push(...result.rows);
      const last = result.rows.at(-1)?.lastChangeDate;
      if (result.count < WB_STATISTICS_PAGE_ROWS || !last) return rows;
      // Полная страница с той же датой: следующий запрос вернул бы её же, а
      // остаток за этой датой не достать ничем — недосчёт хуже отказа.
      if (last === from) {
        throw new WbIncompleteResponseError(
          `${path}: полная страница с одной датой изменения ${last} — остаток не получить`,
        );
      }
      from = last;
    }
    throw new WbIncompleteResponseError(
      `${path}: после ${WB_STATISTICS_MAX_PAGES} полных страниц данные не кончились`,
    );
  }

  /** Вызов «Статистики» с выдержкой лимита 1/мин между вызовами этого клиента. */
  private async statistics(path: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.statisticsCalled) await this.sleep(WB_STATISTICS_INTERVAL_MS);
    this.statisticsCalled = true;
    return this.call(() => this.http.get(`${WB_CATEGORY_HOSTS.statistics}${path}`, { params }));
  }

  /** Склады продавца (FBS). */
  public async listWarehouses(): Promise<IWbWarehouse[]> {
    return mapWarehouses(
      await this.call(() =>
        this.http.get(`${WB_CATEGORY_HOSTS.marketplace}${WB_PATHS.warehouses}`),
      ),
    );
  }

  /** Остатки склада продавца по штрихкодам, батчами по `WB_STOCKS_BATCH`. Только чтение. */
  public async loadSellerStocks(
    warehouseId: string,
    barcodes: readonly string[],
  ): Promise<IWbSellerStock[]> {
    const url = `${WB_CATEGORY_HOSTS.marketplace}${WB_PATHS.sellerStocks(warehouseId)}`;
    const stocks: IWbSellerStock[] = [];
    for (let i = 0; i < barcodes.length; i += WB_STOCKS_BATCH) {
      const body = { skus: barcodes.slice(i, i + WB_STOCKS_BATCH) };
      stocks.push(...mapSellerStocks(await this.call(() => this.http.post(url, body))));
    }
    return stocks;
  }

  /**
   * ЗАПИСЬ остатков склада продавца (TASK-175) — один PUT на батч, БЕЗ повторов
   * (`callWrite`). Батч (≤ `WB_STOCKS_BATCH`) режет вызывающий. Успех — 204 без
   * тела; любой отказ (409 по позициям, 4xx/5xx, сеть) бросает доменную ошибку.
   */
  public async updateSellerStocks(
    warehouseId: string,
    items: readonly IWbStockWrite[],
  ): Promise<void> {
    const url = `${WB_CATEGORY_HOSTS.marketplace}${WB_PATHS.sellerStocks(warehouseId)}`;
    const body = { stocks: items.map((item) => ({ sku: item.barcode, amount: item.amount })) };
    await this.callWrite(() => this.http.put(url, body));
  }

  /**
   * Записывающий запрос — БЕЗ withWbRetry, по образцу `postWrite` ЯМ: WB мог
   * применить остаток и не успеть ответить, повтор вслепую записал бы поверх.
   */
  private async callWrite(request: () => Promise<{ data: unknown }>): Promise<unknown> {
    const response = await request();
    return response.data;
  }

  private async call(request: () => Promise<{ data: unknown }>): Promise<unknown> {
    const response = await withWbRetry(request, this.retry, this.sleep, (error, attempt, delay) =>
      this.logger.warn(
        `WB ${error.status} на ${error.request ?? '?'}: повтор ${attempt} через ${delay} мс`,
      ),
    );
    return response.data;
  }

  private toDomainError(error: AxiosError): WbApiError {
    const response = error.response;
    const reason = error.message || error.code || 'сетевой сбой без описания';
    const headers = (response?.headers ?? {}) as Record<string, unknown>;
    const domain = toWbApiError(
      response?.status,
      response?.data,
      headers['x-ratelimit-retry'] ?? headers['retry-after'],
      reason,
    ).withRequest(error.config?.method, error.config?.url);

    // Только статус, запрос, requestId и текст. config.headers несёт токен.
    this.logger.warn(
      `WB ${response?.status ?? 'нет ответа'} на ${domain.request ?? '?'}` +
        (domain.requestId ? ` [${domain.requestId}]` : '') +
        `: ${domain.message}`,
    );
    return domain;
  }
}

export function mapSellerInfo(raw: unknown): IWbSellerInfo {
  const data = (raw ?? {}) as { name?: unknown; sid?: unknown; tradeMark?: unknown };
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return { name: text(data.name), sid: text(data.sid), tradeMark: text(data.tradeMark) };
}

// ─── Мапперы ответов (TASK-134) ──────────────────────────────────────────────
// Мусорные строки отбрасываются, а не роняют обход — довод мапперов Ozon.

type TRaw = Record<string, unknown>;

function objectsOf(value: unknown): TRaw[] {
  return Array.isArray(value)
    ? value.filter((item): item is TRaw => !!item && typeof item === 'object')
    : [];
}

/** id приходят числами; строкой — чтобы не терять точность и не путать типы. */
function idString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function countOf(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** Ответ cards/list: `{cards: [...], cursor: {updatedAt, nmID, total}}`. */
export function mapCards(raw: unknown): {
  cards: IWbCard[];
  cursor: { updatedAt?: string; nmID?: number };
  total: number;
} {
  const data = (raw ?? {}) as TRaw;
  const cards = objectsOf(data.cards)
    .map((card) => ({
      nmID: idString(card.nmID),
      vendorCode: textOf(card.vendorCode),
      title: textOf(card.title) || undefined,
      brand: textOf(card.brand) || undefined,
      sizes: objectsOf(card.sizes).map((size) => ({
        chrtID: idString(size.chrtID),
        barcodes: (Array.isArray(size.skus) ? size.skus : [])
          .map(textOf)
          .filter((code) => code.length > 0),
      })),
    }))
    .filter((card) => card.nmID.length > 0 || card.vendorCode.length > 0);
  const cursor = (data.cursor ?? {}) as TRaw;
  const nmID = Number(cursor.nmID);
  return {
    cards,
    cursor: {
      updatedAt: textOf(cursor.updatedAt) || undefined,
      nmID: Number.isFinite(nmID) ? nmID : undefined,
    },
    total: countOf(cursor.total),
  };
}

/** Ответ supplier/stocks — массив строк. */
export function mapWbStocks(raw: unknown): IWbStockRow[] {
  return objectsOf(raw)
    .map((row) => ({
      supplierArticle: textOf(row.supplierArticle),
      nmId: idString(row.nmId),
      barcode: textOf(row.barcode),
      warehouseName: textOf(row.warehouseName),
      quantity: countOf(row.quantity),
    }))
    .filter((row) => row.supplierArticle.length > 0 || row.barcode.length > 0);
}

/** Ответ /api/v3/warehouses — массив складов. */
export function mapWarehouses(raw: unknown): IWbWarehouse[] {
  return objectsOf(raw)
    .map((row) => ({
      id: idString(row.id),
      name: textOf(row.name),
      deliveryType:
        typeof row.deliveryType === 'number' && Number.isInteger(row.deliveryType)
          ? row.deliveryType
          : null,
    }))
    .filter((row) => row.id.length > 0);
}

/** Ответ /api/v3/stocks/{id}: `{stocks: [{sku, amount}]}`, `sku` — штрихкод. */
export function mapSellerStocks(raw: unknown): IWbSellerStock[] {
  return objectsOf(((raw ?? {}) as TRaw).stocks)
    .map((row) => ({ barcode: textOf(row.sku), amount: countOf(row.amount) }))
    .filter((row) => row.barcode.length > 0);
}

// ─── Заказы и продажи (TASK-135) ─────────────────────────────────────────────

/** Цена рублями: число ≥ 0, иначе null (ноль от мусора читался бы как бесплатно). */
function priceOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Ответ supplier/orders — массив строк. `count` — сколько объектов пришло до
 * отсева мусора: по нему решается, была ли страница полной.
 */
export function mapWbOrders(raw: unknown): { rows: IWbOrderRow[]; count: number } {
  const objects = objectsOf(raw);
  const rows = objects
    .map((row) => ({
      srid: textOf(row.srid),
      gNumber: textOf(row.gNumber),
      date: textOf(row.date),
      lastChangeDate: textOf(row.lastChangeDate),
      supplierArticle: textOf(row.supplierArticle),
      nmId: idString(row.nmId),
      subject: textOf(row.subject),
      warehouseType: textOf(row.warehouseType),
      priceWithDisc: priceOf(row.priceWithDisc),
      isCancel: row.isCancel === true,
    }))
    .filter((row) => row.srid.length > 0);
  return { rows, count: objects.length };
}

/** Ответ supplier/sales — массив строк; строка без `srid` или `saleID` бесполезна. */
export function mapWbSales(raw: unknown): { rows: IWbSaleRow[]; count: number } {
  const objects = objectsOf(raw);
  const rows = objects
    .map((row) => ({
      srid: textOf(row.srid),
      saleID: textOf(row.saleID),
      lastChangeDate: textOf(row.lastChangeDate),
    }))
    .filter((row) => row.srid.length > 0 && row.saleID.length > 0);
  return { rows, count: objects.length };
}

/** Код рубля в ISO 4217 — валюта `convertedPrice` сборочного задания. */
const RUB_CODE = 643;

/** Ответ /api/v3/orders: `{next, orders: [...]}`. Цены — в копейках. */
export function mapFbsOrders(raw: unknown): { orders: IWbFbsOrder[]; next: number; count: number } {
  const data = (raw ?? {}) as TRaw;
  const objects = objectsOf(data.orders);
  const orders = objects
    .map((row) => {
      const kopecks = priceOf(row.convertedPrice);
      return {
        id: idString(row.id),
        rid: textOf(row.rid),
        createdAt: textOf(row.createdAt),
        article: textOf(row.article),
        nmId: idString(row.nmId),
        price:
          kopecks !== null && Number(row.convertedCurrencyCode) === RUB_CODE ? kopecks / 100 : null,
      };
    })
    .filter((row) => row.id.length > 0);
  const next = Number(data.next);
  return { orders, next: Number.isFinite(next) ? next : 0, count: objects.length };
}

/** Ответ /api/v3/orders/status: `{orders: [{id, supplierStatus, wbStatus}]}`. */
export function mapFbsOrderStatuses(raw: unknown): IWbFbsOrderStatus[] {
  return objectsOf(((raw ?? {}) as TRaw).orders)
    .map((row) => ({
      id: idString(row.id),
      supplierStatus: textOf(row.supplierStatus),
      wbStatus: textOf(row.wbStatus),
    }))
    .filter((row) => row.id.length > 0);
}

// ─── Отчёт реализации (TASK-136) ─────────────────────────────────────────────

/**
 * Ответ reportDetailByPeriod — массив строк (пустой ответ, 204 или `null` —
 * конец). Строки отдаются сырыми: разбор денег — дело журнала финансов, а
 * мусор без `rrd_id` отбрасывается. `count` и `lastRrdId` — до отсева, по
 * ним решается, где курсор.
 */
export function mapWbRealization(raw: unknown): {
  rows: TRaw[];
  count: number;
  lastRrdId: string;
} {
  const objects = objectsOf(raw);
  const rows = objects.filter((row) => /^\d+$/.test(idString(row.rrd_id)));
  return { rows, count: objects.length, lastRrdId: idString(rows.at(-1)?.rrd_id) };
}
