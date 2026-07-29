import { Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { toYandexApiError, YandexApiError } from './yandex-api.errors';
import { campaignsPath, ordersPath, PAGE_LIMITS, returnsPath } from './yandex-api.paths';

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
  status?: string[];
  pageToken?: string;
  limit?: number;
}

export interface IPagedResult<T> {
  items: T[];
  nextPageToken?: string;
}

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

  constructor(
    private readonly credentials: IYandexTenantCredentials,
    baseUrl: string,
    timeoutMs = 30_000,
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
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
   * Одна страница заказов. Постраничный обход, ретраи на 420 и разбиение
   * диапазона по 30-дневному окну — отдельная задача (TASK-020); здесь
   * pageToken просто пробрасывается, чтобы обход можно было построить сверху.
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
        status: query.status,
      },
    );

    return { items: data.orders ?? [], nextPageToken: data.paging?.nextPageToken };
  }

  /** Одна страница возвратов. */
  public async getReturns(
    query: { pageToken?: string; limit?: number } = {},
  ): Promise<IPagedResult<unknown>> {
    const limit = Math.min(query.limit ?? PAGE_LIMITS.returns.default, PAGE_LIMITS.returns.max);

    const data = await this.get<{ returns?: unknown[]; paging?: { nextPageToken?: string } }>(
      returnsPath(this.credentials.campaignId),
      { pageToken: query.pageToken, limit },
    );

    return { items: data.returns ?? [], nextPageToken: data.paging?.nextPageToken };
  }

  /** Список кампаний токена — самая дешёвая проверка, что кред живой. */
  public async getCampaigns(): Promise<unknown[]> {
    const data = await this.get<{ campaigns?: unknown[] }>(campaignsPath(), {});
    return data.campaigns ?? [];
  }

  private async get<T>(path: string, params: Record<string, unknown>): Promise<T> {
    // Логируем путь и кампанию, но НИКОГДА заголовки: там токен продавца.
    this.logger.debug(`GET ${path} (кампания ${this.credentials.campaignId})`);
    const response = await this.http.get<T>(path, { params: prune(params) });
    return response.data;
  }

  private toDomainError(error: AxiosError): YandexApiError {
    const status = error.response?.status;
    const domain = toYandexApiError(status, error.response?.data, error.message);
    this.logger.error(
      `Partner API ${status ?? 'нет ответа'} на ${error.config?.url} (кампания ${this.credentials.campaignId}): ${domain.message}`,
    );
    return domain;
  }
}

/** undefined-параметры убираем: axios иначе шлёт `?limit=50&status=`. */
function prune(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  );
}
