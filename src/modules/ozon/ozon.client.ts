import { Logger } from '@nestjs/common';
import axios, { type AxiosError, type AxiosInstance } from 'axios';

import { shiftDay } from '../finance/finance-period';
import { type IOzonAccrualType } from '../finance/ozon-journal';
import { type IRetryOptions, type TSleep, realSleep } from '../yandex/yandex-retry';

import { OZON_RETRY, withOzonRetry } from './ozon-retry';
import { type OzonApiError, toOzonApiError } from './ozon.errors';

/**
 * HTTP-клиент Ozon Seller API.
 *
 * Авторизация — пара заголовков `Client-Id` + `Api-Key`, у каждого продавца
 * своя, поэтому клиент создаётся на креды (OzonClientFactory), как клиент
 * Partner API на токен. Ключ живёт только в заголовках экземпляра axios: в логи
 * идут метод, путь, статус и код ответа — никогда `config.headers`.
 *
 * `proxy: false` — не брать HTTPS_PROXY из окружения: прокси, если понадобится,
 * задаётся явно (прецедент POLZA_AI_PROXY_URL).
 */

export const OZON_TIMEOUT_MS = 30_000;

export const OZON_PATHS = {
  /** AccessAPI_RolesByToken: роли и методы ключа, срок его действия. */
  roles: '/v1/roles',
  /** ProductAPI_GetProductList: product_id/offer_id карточек, пагинация `last_id`. */
  productList: '/v3/product/list',
  /** ProductAPI_GetProductInfoList: название, штрихкоды, цена — по списку product_id. */
  productInfoList: '/v3/product/info/list',
  /** ProductAPI_GetProductInfoStocks: остатки по типам склада, пагинация `cursor`. */
  productStocks: '/v4/product/info/stocks',
  /** PostingAPI_GetFbsPostingListV3: отправления FBS, период ≤ 1 года, `offset` + `has_next`. */
  fbsPostings: '/v3/posting/fbs/list',
  /** PostingAPI_GetFboPostingList: отправления FBO, `offset`, `result` — массив без `has_next`. */
  fboPostings: '/v2/posting/fbo/list',
  /**
   * GetFinanceAccrualByDay: начисления за ОДИН день, курсор `last_id` (живёт 15 мин). Заменил
   * /v3/finance/transaction/list — тот Ozon отключил 8.09.2026 (TASK-194).
   */
  financeAccrualByDay: '/v1/finance/accrual/by-day',
  /** GetFinanceAccrualTypes: справочник типов начислений `{id, name, description}`. */
  financeAccrualTypes: '/v1/finance/accrual/types',
  /**
   * FinanceAPI_FinanceBalance: сальдо и выплаты за `date_from…date_to` (≤ 30 дней). Берём по ОДНОМУ
   * дню — выплаты по операции API не даёт, день с `payments > 0` и есть выплата (TASK-184).
   */
  financeBalance: '/v1/finance/balance',
  /** WarehouseAPI_WarehouseList: склады FBS/rFBS продавца (TASK-175). Чтение. */
  warehouses: '/v1/warehouse/list',
  /** ProductAPI_ProductsStocksV2: ЗАПИСЬ остатков FBS на склад продавца (TASK-175) — без повторов. */
  stocksWrite: '/v2/products/stocks',
} as const;

/**
 * Позиций в одном запросе записи остатков — потолок Ozon (100). Больше — 400
 * на весь запрос.
 */
export const OZON_STOCKS_WRITE_BATCH = 100;

/**
 * Страница отправлений. Источники расходятся: у FBS встречается и 1000, и 50,
 * у FBO — 1000 и 100 (а в v3 Ozon снизил до 100). Берём нижние границы — запросов
 * больше, но ни один не упрётся в 400 «limit» (довод `OZON_INFO_BATCH`).
 */
export const OZON_FBS_POSTINGS_LIMIT = 50;
export const OZON_FBO_POSTINGS_LIMIT = 100;

/** Размер страницы списков товаров и остатков — максимум, который принимает Ozon. */
export const OZON_PAGE_LIMIT = 1000;

/**
 * Сколько product_id в одном запросе info/list. Спека говорит «до 1000», но
 * источники расходятся (встречается 100) — берём нижнюю границу: запросов
 * больше, но ни один не упрётся в 400 «слишком много» (урок offer-mappings ЯМ).
 */
export const OZON_INFO_BATCH = 100;

/**
 * Потолок страниц одного обхода. Ozon, отдающий тот же курсор по кругу, иначе
 * держал бы воркер вечно; 1000 страниц × 1000 строк — миллион карточек.
 */
export const OZON_MAX_PAGES = 1000;

export interface IOzonCredentials {
  clientId: string;
  apiKey: string;
}

export interface IOzonClientOptions {
  retry?: IRetryOptions;
  sleep?: TSleep;
  timeoutMs?: number;
}

export interface IOzonRole {
  name: string;
  methods: string[];
}

export interface IOzonRoles {
  roles: IOzonRole[];
  /** Срок действия ключа (ISO), если Ozon его прислал. */
  expiresAt: string | null;
}

/** Карточка товара Ozon в объёме, нужном базе товаров. */
export interface IOzonProduct {
  productId: string;
  /** Артикул продавца — ключ карточки в `Product.marketplaceSkus.ozon`. */
  offerId: string;
  name?: string;
  barcodes: string[];
  /** SKU Ozon (числовой), если пришёл: его несут финансовые операции. */
  sku?: string;
  /**
   * Все SKU Ozon карточки — общий, FBO, FBS и из `sources[]` (TASK-131): у
   * схем SKU бывают разные, а операция несёт тот, по которой продано.
   */
  skus: string[];
  price?: number;
  currency?: string;
  archived: boolean;
}

/** Остаток одного типа склада. */
export interface IOzonStockAmount {
  /** Лежит на складе. */
  present: number;
  /** Из них зарезервировано под заказы. */
  reserved: number;
}

/**
 * Остатки карточки. FBO — склад Ozon, FBS — склад продавца: это разные
 * склады, и суммы нет намеренно (довод «FBY read-only»).
 */
export interface IOzonStock {
  productId: string;
  offerId: string;
  fbo: IOzonStockAmount;
  fbs: IOzonStockAmount;
}

/** Позиция отправления. */
export interface IOzonPostingProduct {
  /** Артикул продавца (`offer_id`). */
  offerId: string;
  name?: string;
  quantity: number;
  /** Цена за штуку из ответа; нет — undefined. */
  price?: number;
  currency?: string;
}

/** Отправление FBS или FBO в объёме, нужном общему заказу. */
export interface IOzonPosting {
  postingNumber: string;
  orderNumber: string;
  status: string;
  substatus: string;
  /** Начало обработки (ISO) — по нему Ozon фильтрует период. */
  inProcessAt: string;
  products: IOzonPostingProduct[];
}

/** Склад продавца из /v1/warehouse/list (TASK-175). */
export interface IOzonWarehouse {
  id: string;
  name: string;
  /** rFBS — доставка силами продавца; склад всё равно его собственный. */
  isRfbs: boolean;
  /** `created` — рабочий; `new`, `disabled`, `blocked`… — нет. */
  status: string;
}

/** Позиция записи остатка: артикул продавца и новое количество. */
export interface IOzonStockWrite {
  offerId: string;
  stock: number;
}

/** Итог записи одной позиции из ответа /v2/products/stocks. */
export interface IOzonStockWriteResult {
  offerId: string;
  updated: boolean;
  /** Текст ошибок Ozon по позиции; пусто — записано. */
  message?: string;
}

/** Строка /v3/product/list. */
interface IOzonListedProduct {
  productId: string;
  offerId: string;
  archived: boolean;
}

export class OzonSellerClient {
  private readonly logger = new Logger(OzonSellerClient.name);
  private readonly http: AxiosInstance;
  private readonly retry: IRetryOptions;
  private readonly sleep: TSleep;

  constructor(baseUrl: string, credentials: IOzonCredentials, options: IOzonClientOptions = {}) {
    this.retry = options.retry ?? OZON_RETRY;
    this.sleep = options.sleep ?? realSleep;

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: options.timeoutMs ?? OZON_TIMEOUT_MS,
      proxy: false,
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': credentials.clientId,
        'Api-Key': credentials.apiKey,
      },
    });

    this.http.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => Promise.reject(this.toDomainError(error)),
    );
  }

  /** Роли ключа. Ничего не меняет у продавца — им и проверяется ключ до записи. */
  public async roles(): Promise<IOzonRoles> {
    return mapRoles(await this.call(() => this.http.post(OZON_PATHS.roles, {})));
  }

  /**
   * Весь каталог продавца: список карточек (`last_id`), затем их описание
   * батчами по product_id. Только чтение.
   */
  public async listProducts(): Promise<IOzonProduct[]> {
    const listed: IOzonListedProduct[] = [];
    let lastId = '';
    for (let page = 0; page < OZON_MAX_PAGES; page += 1) {
      const body = { filter: { visibility: 'ALL' }, last_id: lastId, limit: OZON_PAGE_LIMIT };
      const result = mapProductList(
        await this.call(() => this.http.post(OZON_PATHS.productList, body)),
      );
      listed.push(...result.items);
      if (!result.items.length || !result.lastId || result.lastId === lastId) break;
      lastId = result.lastId;
    }

    const byId = new Map(listed.map((item) => [item.productId, item]));
    const ids = [...byId.keys()];
    const products: IOzonProduct[] = [];
    for (let i = 0; i < ids.length; i += OZON_INFO_BATCH) {
      const body = { product_id: ids.slice(i, i + OZON_INFO_BATCH) };
      const info = mapProductInfo(
        await this.call(() => this.http.post(OZON_PATHS.productInfoList, body)),
      );
      for (const product of info) {
        const known = byId.get(product.productId);
        products.push({
          ...product,
          offerId: product.offerId || known?.offerId || '',
          archived: product.archived || (known?.archived ?? false),
        });
      }
    }
    return products;
  }

  /** Остатки всех карточек по типам склада (`cursor`). Только чтение. */
  public async loadStocks(): Promise<IOzonStock[]> {
    const stocks: IOzonStock[] = [];
    let cursor = '';
    for (let page = 0; page < OZON_MAX_PAGES; page += 1) {
      const body = { filter: { visibility: 'ALL' }, cursor, limit: OZON_PAGE_LIMIT };
      const result = mapStocks(
        await this.call(() => this.http.post(OZON_PATHS.productStocks, body)),
      );
      stocks.push(...result.items);
      if (!result.items.length || !result.cursor || result.cursor === cursor) break;
      cursor = result.cursor;
    }
    return stocks;
  }

  /**
   * Отправления FBS за интервал (по началу обработки). Только чтение. Интервал
   * короче года — режет вызывающий; здесь только страницы `offset` до
   * `has_next: false`.
   */
  public async listFbsPostings(since: Date, to: Date): Promise<IOzonPosting[]> {
    const postings: IOzonPosting[] = [];
    for (let page = 0; page < OZON_MAX_PAGES; page += 1) {
      const body = {
        dir: 'ASC',
        filter: { since: since.toISOString(), to: to.toISOString() },
        limit: OZON_FBS_POSTINGS_LIMIT,
        offset: page * OZON_FBS_POSTINGS_LIMIT,
      };
      const result = mapFbsPostings(
        await this.call(() => this.http.post(OZON_PATHS.fbsPostings, body)),
      );
      postings.push(...result.postings);
      if (!result.hasNext || !result.postings.length) break;
    }
    return postings;
  }

  /**
   * Отправления FBO за интервал. Только чтение. `has_next` у метода нет —
   * обход до неполной страницы.
   */
  public async listFboPostings(since: Date, to: Date): Promise<IOzonPosting[]> {
    const postings: IOzonPosting[] = [];
    for (let page = 0; page < OZON_MAX_PAGES; page += 1) {
      const body = {
        dir: 'ASC',
        filter: { since: since.toISOString(), to: to.toISOString() },
        limit: OZON_FBO_POSTINGS_LIMIT,
        offset: page * OZON_FBO_POSTINGS_LIMIT,
      };
      const batch = mapFboPostings(
        await this.call(() => this.http.post(OZON_PATHS.fboPostings, body)),
      );
      postings.push(...batch);
      if (batch.length < OZON_FBO_POSTINGS_LIMIT) break;
    }
    return postings;
  }

  /**
   * Начисления за один день (TASK-194) — как пришли, сырыми объектами: их
   * сохраняет журнал (`raw`), а разбирает `ozon-journal.ts`. Только чтение.
   *
   * Курсор `last_id` — с тем же `date` (иначе Ozon отвечает 400); пустой —
   * день кончился. Счётчика строк у метода нет, поэтому неполный ответ ловится
   * формой: ответ без массива `accruals`, тот же курсор по кругу или потолок
   * страниц — ошибка, а не «всё»: импорт снимает строки периода, которых нет
   * в новой версии, и недокачанный день снял бы настоящие начисления.
   */
  public async listAccrualsByDay(day: string): Promise<TRaw[]> {
    const byId = new Map<string, TRaw>();
    const seen = new Set<string>();
    let lastId = '';
    for (let page = 1; page <= OZON_MAX_PAGES; page += 1) {
      const body = { date: day, last_id: lastId };
      const result = mapAccrualsByDay(
        await this.call(() => this.http.post(OZON_PATHS.financeAccrualByDay, body)),
      );
      if (!result.complete) {
        throw new Error(`Ozon не отдал список начислений за ${day}: журнал не тронут`);
      }
      for (const accrual of result.accruals) byId.set(idString(accrual.accrual_id), accrual);
      if (!result.lastId || !result.accruals.length) return [...byId.values()];
      if (seen.has(result.lastId)) {
        throw new Error(
          `Ozon вернул тот же курсор начислений за ${day}: список неполный, журнал не тронут`,
        );
      }
      seen.add(result.lastId);
      lastId = result.lastId;
    }
    throw new Error(`Начисления Ozon за ${day} не уложились в ${OZON_MAX_PAGES} страниц`);
  }

  /**
   * Начисления за дни `from…to` включительно (ГГГГ-ММ-ДД) — ПОСЛЕДОВАТЕЛЬНО:
   * метод берёт один день, а параллельные запросы ловят 429 уже на 0,3 rps.
   */
  public async listAccruals(from: string, to: string): Promise<TRaw[]> {
    const accruals: TRaw[] = [];
    for (let day = from; day <= to; day = shiftDay(day, 1)) {
      accruals.push(...(await this.listAccrualsByDay(day)));
    }
    return accruals;
  }

  /** Справочник типов начислений: id → английское имя и русское описание. */
  public async listAccrualTypes(): Promise<IOzonAccrualType[]> {
    return mapAccrualTypes(
      await this.call(() => this.http.post(OZON_PATHS.financeAccrualTypes, {})),
    );
  }

  /**
   * Сальдо и выплаты за один день (TASK-184, ГГГГ-ММ-ДД). Только чтение. Ответ
   * не того вида — ошибка, а не нули: «выплат не было» проставило бы строкам
   * «к получению» то, что Ozon уже перечислил.
   */
  public async balanceOfDay(day: string): Promise<IOzonDayBalance> {
    const body = { date_from: day, date_to: day };
    return mapFinanceBalance(
      await this.call(() => this.http.post(OZON_PATHS.financeBalance, body)),
      day,
    );
  }

  /** Склады продавца (FBS и rFBS). Только чтение. */
  public async listWarehouses(): Promise<IOzonWarehouse[]> {
    return mapWarehouses(await this.call(() => this.http.post(OZON_PATHS.warehouses, {})));
  }

  /**
   * ЗАПИСЬ остатков на склад продавца (TASK-175) — один запрос на батч, БЕЗ
   * повторов (`callWrite`). Батч режет вызывающий (`OZON_STOCKS_WRITE_BATCH`):
   * здесь только один запрос. Ozon отвечает построчно — `updated` и `errors`
   * по каждой позиции; HTTP 200 ещё не значит «записано всё».
   */
  public async updateStocks(
    warehouseId: string,
    items: readonly IOzonStockWrite[],
  ): Promise<IOzonStockWriteResult[]> {
    const body = {
      stocks: items.map((item) => ({
        offer_id: item.offerId,
        stock: item.stock,
        warehouse_id: Number(warehouseId),
      })),
    };
    return mapStocksWrite(await this.callWrite(() => this.http.post(OZON_PATHS.stocksWrite, body)));
  }

  /**
   * Записывающий запрос — БЕЗ withOzonRetry, по образцу `postWrite` ЯМ: Ozon мог
   * применить остаток и не успеть ответить (таймаут, 5xx), а повтор вслепую
   * записал бы поверх уже изменившегося остатка. Ошибка уходит в отчёт записи.
   */
  private async callWrite(request: () => Promise<{ data: unknown }>): Promise<unknown> {
    const response = await request();
    return response.data;
  }

  private async call(request: () => Promise<{ data: unknown }>): Promise<unknown> {
    const response = await withOzonRetry(request, this.retry, this.sleep, (error, attempt, delay) =>
      this.logger.warn(
        `Ozon ${error.status} на ${error.request ?? '?'}: повтор ${attempt} через ${delay} мс`,
      ),
    );
    return response.data;
  }

  private toDomainError(error: AxiosError): OzonApiError {
    const response = error.response;
    const reason = error.message || error.code || 'сетевой сбой без описания';
    const headers = (response?.headers ?? {}) as Record<string, unknown>;
    const domain = toOzonApiError(
      response?.status,
      response?.data,
      headers['retry-after'],
      reason,
    ).withRequest(error.config?.method, error.config?.url);

    // Только статус, запрос, код и текст. config.headers несёт Api-Key.
    this.logger.warn(
      `Ozon ${response?.status ?? 'нет ответа'} на ${domain.request ?? '?'}` +
        (domain.code ? ` [${domain.code}]` : '') +
        `: ${domain.message}`,
    );
    return domain;
  }
}

/** Разбор ответа /v1/roles: `{roles: [{name, methods}], expires_at}`. Мусор отбрасывается. */
export function mapRoles(raw: unknown): IOzonRoles {
  const data = (raw ?? {}) as { roles?: unknown; expires_at?: unknown };
  const roles = Array.isArray(data.roles) ? data.roles : [];
  return {
    roles: roles
      .map((role) => (role ?? {}) as { name?: unknown; methods?: unknown })
      .filter((role) => typeof role.name === 'string' && role.name.length > 0)
      .map((role) => ({
        name: role.name as string,
        methods: Array.isArray(role.methods)
          ? role.methods.filter((m): m is string => typeof m === 'string')
          : [],
      })),
    expiresAt:
      typeof data.expires_at === 'string' && data.expires_at.length > 0 ? data.expires_at : null,
  };
}

// ─── Разбор ответов каталога (TASK-129) ──────────────────────────────────────
//
// Ozon кладёт данные то в `result`, то на верхний уровень (у v3/v4 по-разному),
// поэтому читаются оба уровня — урок `/returns` ЯМ, где не тот уровень молча
// давал пустой список. Мусорные строки отбрасываются, а не роняют обход.

type TRaw = Record<string, unknown>;

function levelOf(raw: unknown): TRaw {
  const data = (raw ?? {}) as TRaw;
  const result = data.result;
  return result && typeof result === 'object' && !Array.isArray(result) ? (result as TRaw) : data;
}

function itemsOf(raw: unknown): TRaw[] {
  const data = (raw ?? {}) as TRaw;
  const nested = levelOf(raw).items;
  const items = Array.isArray(nested) ? nested : data.items;
  return Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
}

/** id приходят числами; строкой их держим, чтобы не терять точность и не путать типы. */
function idString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOf(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** Ответ /v3/product/list: `{result: {items, total, last_id}}`. */
export function mapProductList(raw: unknown): { items: IOzonListedProduct[]; lastId: string } {
  const items = itemsOf(raw)
    .map((item) => ({
      productId: idString(item.product_id),
      offerId: textOf(item.offer_id),
      archived: item.archived === true,
    }))
    .filter((item) => item.productId.length > 0);
  return { items, lastId: textOf(levelOf(raw).last_id) };
}

/** Ответ /v3/product/info/list: `{items: [{id, offer_id, name, barcodes, …}]}`. */
export function mapProductInfo(raw: unknown): IOzonProduct[] {
  return itemsOf(raw)
    .map((item) => {
      const barcodes = Array.isArray(item.barcodes)
        ? item.barcodes.map(textOf).filter((code) => code.length > 0)
        : [];
      const single = textOf(item.barcode);
      if (single && !barcodes.includes(single)) barcodes.push(single);
      return {
        productId: idString(item.id ?? item.product_id),
        offerId: textOf(item.offer_id),
        name: textOf(item.name) || undefined,
        barcodes,
        sku: idString(item.sku) || skuFromSources(item.sources) || undefined,
        skus: allSkus(item),
        price: numberOf(item.price),
        currency: textOf(item.currency_code) || undefined,
        archived: item.is_archived === true || item.archived === true,
      };
    })
    .filter((product) => product.productId.length > 0);
}

function allSkus(item: TRaw): string[] {
  const skus = new Set<string>();
  for (const value of [item.sku, item.fbo_sku, item.fbs_sku]) {
    const sku = idString(value);
    if (sku && sku !== '0') skus.add(sku);
  }
  for (const source of Array.isArray(item.sources) ? item.sources : []) {
    const sku = idString((source as TRaw | null)?.sku);
    if (sku && sku !== '0') skus.add(sku);
  }
  return [...skus];
}

function skuFromSources(sources: unknown): string {
  if (!Array.isArray(sources)) return '';
  for (const source of sources) {
    const sku = idString((source as TRaw | null)?.sku);
    if (sku) return sku;
  }
  return '';
}

/** Ответ /v4/product/info/stocks: `{items: [{product_id, offer_id, stocks: [{type, present, reserved}]}], cursor}`. */
export function mapStocks(raw: unknown): { items: IOzonStock[]; cursor: string } {
  const items = itemsOf(raw)
    .map((item) => {
      const stock: IOzonStock = {
        productId: idString(item.product_id),
        offerId: textOf(item.offer_id),
        fbo: { present: 0, reserved: 0 },
        fbs: { present: 0, reserved: 0 },
      };
      for (const row of Array.isArray(item.stocks) ? (item.stocks as TRaw[]) : []) {
        const type = textOf(row?.type).toLowerCase();
        // Незнакомый тип склада не складываем ни в FBO, ни в FBS: угаданный
        // склад — та же ошибка, что сумма чужого и своего.
        if (type !== 'fbo' && type !== 'fbs') continue;
        stock[type].present += numberOf(row.present) ?? 0;
        stock[type].reserved += numberOf(row.reserved) ?? 0;
      }
      return stock;
    })
    .filter((stock) => stock.productId.length > 0 || stock.offerId.length > 0);
  const data = (raw ?? {}) as TRaw;
  return { items, cursor: textOf(data.cursor) || textOf(levelOf(raw).cursor) };
}

// ─── Склады и запись остатков (TASK-175) ─────────────────────────────────────

/** Ответ /v1/warehouse/list: `{result: [{warehouse_id, name, is_rfbs, status}]}`. */
export function mapWarehouses(raw: unknown): IOzonWarehouse[] {
  const data = (raw ?? {}) as TRaw;
  const list = Array.isArray(data.result) ? data.result : [];
  return list
    .filter((item): item is TRaw => !!item && typeof item === 'object')
    .map((item) => ({
      id: idString(item.warehouse_id),
      name: textOf(item.name),
      isRfbs: item.is_rfbs === true,
      status: textOf(item.status).toLowerCase(),
    }))
    .filter((warehouse) => warehouse.id.length > 0);
}

/**
 * Ответ /v2/products/stocks: `{result: [{offer_id, updated, errors: [{code, message}]}]}`.
 * Позиция без `updated: true` — не записана (неизвестное = не записано).
 */
export function mapStocksWrite(raw: unknown): IOzonStockWriteResult[] {
  const data = (raw ?? {}) as TRaw;
  const list = Array.isArray(data.result) ? data.result : [];
  return list
    .filter((item): item is TRaw => !!item && typeof item === 'object')
    .map((item) => {
      const errors = (Array.isArray(item.errors) ? (item.errors as TRaw[]) : [])
        .map((error) => textOf(error?.message) || textOf(error?.code))
        .filter((text) => text.length > 0);
      const updated = item.updated === true;
      return {
        offerId: textOf(item.offer_id),
        updated,
        message: updated ? undefined : errors.join('; ') || 'Ozon не подтвердил запись',
      };
    });
}

// ─── Начисления (TASK-194) ───────────────────────────────────────────────────

/**
 * Ответ /v1/finance/accrual/by-day: `{accruals, last_id}` (обёртка `result`
 * тоже принимается). Начисления остаются сырыми; отброшены только объекты без
 * `accrual_id` — ключа дедупа у них нет. `complete: false` — массива нет вовсе:
 * это не «пустой день», а ответ, которого мы не знаем.
 */
export function mapAccrualsByDay(raw: unknown): {
  accruals: TRaw[];
  lastId: string;
  complete: boolean;
} {
  const level = levelOf(raw);
  const list = Array.isArray(level.accruals) ? level.accruals : null;
  return {
    accruals: (list ?? []).filter(
      (item): item is TRaw =>
        !!item && typeof item === 'object' && idString((item as TRaw).accrual_id).length > 0,
    ),
    lastId: idString(level.last_id),
    complete: list !== null,
  };
}

/** Ответ /v1/finance/accrual/types: `{accrual_types: [{id, name, description}]}`. */
export function mapAccrualTypes(raw: unknown): IOzonAccrualType[] {
  const level = levelOf(raw);
  const list = Array.isArray(level.accrual_types) ? (level.accrual_types as unknown[]) : [];
  return list
    .filter((item): item is TRaw => !!item && typeof item === 'object')
    .map((item) => ({
      id: idString(item.id),
      name: textOf(item.name),
      description: textOf(item.description),
    }))
    .filter((type) => type.id.length > 0);
}

// ─── Сальдо и выплаты (TASK-184) ─────────────────────────────────────────────

/** Сальдо дня Ozon в копейках. */
export interface IOzonDayBalance {
  /** Сколько Ozon должен продавцу на начало дня (`total.opening_balance`). */
  openingKopecks: number;
  /** Сколько перечислил в этот день (Σ `total.payments`). */
  paymentsKopecks: number;
}

/** Валюты выплат, которые журнал понимает: он в рублёвых копейках. Пустая — рубли. */
const BALANCE_CURRENCIES = new Set(['', 'RUB', 'RUR']);

/**
 * Сумма из ответа balance в копейках: `{value, currency_code}` или голое число
 * (схема — только из спеки, живого примера нет). Чужая валюта и не-число —
 * ошибка: в рублёвый журнал их не сложить.
 */
function balanceKopecks(value: unknown, what: string, day: string): number {
  const money = value && typeof value === 'object' ? (value as TRaw) : { value };
  const currency = textOf(money.currency_code ?? money.currency).toUpperCase();
  if (!BALANCE_CURRENCIES.has(currency)) {
    throw new Error(`Ozon отдал ${what} за ${day} в валюте ${currency}: выплаты не разложены`);
  }
  const rubles = numberOf(money.value ?? money.amount);
  if (rubles === undefined) {
    throw new Error(`Ozon не отдал ${what} за ${day}: выплаты не разложены`);
  }
  return Math.round(rubles * 100);
}

/**
 * Ответ /v1/finance/balance: `{total: {opening_balance, accrued, closing_balance,
 * payments: [{currency_code, value}]}}` (обёртка `result` тоже принимается).
 * Нет `total` или `opening_balance` — ошибка: неизвестное сальдо не ноль.
 * Пустой `payments` — выплат в этот день не было. Знак выплаты спека не
 * фиксирует (вычитается ли она из сальдо минусом) — берём модуль: выплата
 * всегда от Ozon продавцу.
 */
export function mapFinanceBalance(raw: unknown, day: string): IOzonDayBalance {
  const total = levelOf(raw).total;
  if (!total || typeof total !== 'object') {
    throw new Error(`Ozon не отдал сальдо за ${day}: выплаты не разложены`);
  }
  const data = total as TRaw;
  const payments = Array.isArray(data.payments) ? data.payments : [];
  return {
    openingKopecks: balanceKopecks(data.opening_balance, 'входящее сальдо', day),
    paymentsKopecks: payments.reduce<number>(
      (sum, payment) => sum + Math.abs(balanceKopecks(payment, 'выплату', day)),
      0,
    ),
  };
}

// ─── Разбор отправлений (TASK-130) ───────────────────────────────────────────

/** Ответ /v3/posting/fbs/list: `{result: {postings, has_next}}`. */
export function mapFbsPostings(raw: unknown): { postings: IOzonPosting[]; hasNext: boolean } {
  const level = levelOf(raw);
  const list = Array.isArray(level.postings) ? level.postings : [];
  return { postings: mapPostings(list), hasNext: level.has_next === true };
}

/** Ответ /v2/posting/fbo/list: `{result: [...]}` — массив прямо в `result`. */
export function mapFboPostings(raw: unknown): IOzonPosting[] {
  const data = (raw ?? {}) as TRaw;
  const list = Array.isArray(data.result) ? data.result : levelOf(raw).postings;
  return mapPostings(Array.isArray(list) ? list : []);
}

function mapPostings(list: unknown[]): IOzonPosting[] {
  return list
    .filter((item): item is TRaw => !!item && typeof item === 'object')
    .map((item) => ({
      postingNumber: textOf(item.posting_number),
      orderNumber: textOf(item.order_number) || idString(item.order_id),
      status: textOf(item.status),
      substatus: textOf(item.substatus),
      inProcessAt: textOf(item.in_process_at) || textOf(item.created_at),
      products: (Array.isArray(item.products) ? (item.products as TRaw[]) : [])
        .filter((product) => !!product && typeof product === 'object')
        .map((product) => ({
          offerId: textOf(product.offer_id),
          name: textOf(product.name) || undefined,
          quantity: numberOf(product.quantity) ?? 0,
          price: numberOf(product.price),
          currency: textOf(product.currency_code) || undefined,
        })),
    }))
    .filter((posting) => posting.postingNumber.length > 0);
}
