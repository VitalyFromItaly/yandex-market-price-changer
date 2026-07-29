import type { IHttpClient } from '../../../transport/http';
import type { TOffer, TPaging, TUpdateOffer, TUpdateStocksRequest } from '../yandex.domain';

import * as fs from 'fs';

export type TOffersResponse = {
  status: string;
  result: {
    paging: TPaging;
    offers: TOffer[];
  };
};

// Типы для создания карточек товаров
export interface ICreateOfferMapping {
  offer: {
    offerId: string;
    name: string;
    marketCategoryId?: number;
    pictures?: string[];
    vendor?: string;
    description?: string;
    barcodes?: string[];
    vendorCode?: string;
    basicPrice?: {
      value: number;
      currencyId: string;
    };
    manufacturerCountries?: string[];
    weightDimensions?: {
      length: number;
      width: number;
      height: number;
      weight: number;
    };
  };
  mapping?: {
    marketSku?: number;
  };
}

export interface ICreateOfferMappingsRequest {
  offerMappings: ICreateOfferMapping[];
  onlyPartnerMediaContent?: boolean;
}

export interface ICreateOfferMappingsResponse {
  status: string;
  result?: {
    offerMappings: Array<{
      offer: {
        offerId: string;
      };
      mapping?: {
        marketSku?: number;
      };
      errors?: Array<{
        code: string;
        message: string;
      }>;
      warnings?: Array<{
        code: string;
        message: string;
      }>;
    }>;
  };
  errors?: Array<{
    code: string;
    message: string;
  }>;
}

/**
 * @deprecated Обслуживал отключённое изменение цен. Из нового кода не вызывать.
 *
 * Дефекты, которые НЕЛЬЗЯ повторить в новом клиенте (TASK-019):
 *
 * 1. Пути запросов БЕЗ версии (`/campaigns/{id}/offers` вместо
 *    `v2/campaigns/{id}/offers`). Яндекс объявил версию в пути обязательной и
 *    предупредил, что скоро отключит неверсионированные запросы.
 * 2. loadAllOffers пишет `fs.writeFileSync('src/modules/yandex/offers.json')`
 *    на КАЖДЫЙ вызов: путь относительно cwd, файл общий для всех продавцов
 *    (последний записавший затирает предыдущего), и запись стоит внутри try —
 *    ENOENT уронил бы весь конвейер.
 * 3. MAX_LIMIT = 200 взят для offers. Для заказов лимит страницы 1–50,
 *    для возвратов до 100 — переносить это число нельзя.
 *
 * updateOfferPrice и createOfferMappings относятся к отключённому изменению цен.
 * updateOfferStock тоже помечен deprecated, но именно остатки планируется
 * вернуть отдельной задачей (TASK-035) — реализовывать заново.
 */
export class OfferService {
  private readonly MAX_LIMIT = 200; // Максимальное количество товаров на странице

  constructor(
    private readonly httpClient: IHttpClient,
    private readonly campaign_id: number,
    private readonly business_id: number,
  ) {}

  public async loadAllOffers(): Promise<TOffer[]> {
    try {
      const allOffers: TOffer[] = [];
      let nextPageToken: string | undefined;

      do {
        const url = nextPageToken
          ? `/campaigns/${this.campaign_id}/offers?limit=${this.MAX_LIMIT}&page_token=${nextPageToken}`
          : `/campaigns/${this.campaign_id}/offers?limit=${this.MAX_LIMIT}`;

        console.log(`Loading offers page with URL: ${url}`);

        const response = await this.httpClient.post<TOffersResponse>(url, {});

        const { offers, paging } = response.data?.result || {};

        if (offers && offers.length > 0) {
          allOffers.push(...offers);
          console.log(`Loaded ${offers.length} offers. Total: ${allOffers.length}`);
        }

        nextPageToken = paging?.nextPageToken;
      } while (nextPageToken);

      console.log(`Loaded all offers. Total count: ${allOffers.length}`);
      fs.writeFileSync('src/modules/yandex/offers.json', JSON.stringify(allOffers, null, 2));
      return allOffers;
    } catch (error) {
      console.error('Error fetching all offers:', error);
      throw error;
    }
  }

  public async updateOfferPrice(offers: { offers: TUpdateOffer[] }) {
    try {
      console.log({ offers });
      const response = await this.httpClient.post(
        `businesses/${this.business_id}/offer-prices/updates`,
        offers,
      );
      console.log({ response });
    } catch (error) {
      console.error('Error updating the offers price: ', error);
      throw error;
    }
  }

  public async updateOfferStock(stocksData: TUpdateStocksRequest) {
    try {
      const response = await this.httpClient.put(
        `/campaigns/${this.campaign_id}/offers/stocks`,
        stocksData,
      );
      console.log({ stockUpdateResponse: response.data });
      return response.data;
    } catch (error) {
      console.error('Error updating the offers stock: ', error);
      throw error;
    }
  }

  /**
   * Создание новых карточек товаров в каталоге Yandex Market
   *
   * @param offerMappings - Массив товаров для создания
   * @param onlyPartnerMediaContent - Использовать только данные партнера (по умолчанию false)
   * @returns Результат создания карточек
   */
  public async createOfferMappings(
    offerMappings: ICreateOfferMapping[],
    onlyPartnerMediaContent: boolean = false,
  ): Promise<ICreateOfferMappingsResponse> {
    try {
      if (!offerMappings || offerMappings.length === 0) {
        throw new Error('offerMappings array cannot be empty');
      }

      if (offerMappings.length > 100) {
        throw new Error('Maximum 100 offers can be created at once');
      }

      const requestBody: ICreateOfferMappingsRequest = {
        offerMappings,
        onlyPartnerMediaContent,
      };

      console.log(
        `Creating ${offerMappings.length} offer mappings for business ${this.business_id}`,
      );
      console.log(
        'Request body sample:',
        JSON.stringify(
          {
            ...requestBody,
            offerMappings: requestBody.offerMappings.slice(0, 2), // Показываем только первые 2 для логирования
          },
          null,
          2,
        ),
      );

      const response = await this.httpClient.post<ICreateOfferMappingsResponse>(
        `businesses/${this.business_id}/offer-mappings/update`,
        requestBody,
      );

      console.log('Create offer mappings response status:', response.data.status);

      if (response.data.result?.offerMappings) {
        const successCount = response.data.result.offerMappings.filter(
          (offer) => !offer.errors || offer.errors.length === 0,
        ).length;
        const errorCount = response.data.result.offerMappings.filter(
          (offer) => offer.errors && offer.errors.length > 0,
        ).length;

        console.log(`Offer mappings created - Success: ${successCount}, Errors: ${errorCount}`);

        // Логируем ошибки, если есть
        response.data.result.offerMappings.forEach((offer) => {
          if (offer.errors && offer.errors.length > 0) {
            console.error(`Errors for offer ${offer.offer.offerId}:`, offer.errors);
          }
          if (offer.warnings && offer.warnings.length > 0) {
            console.warn(`Warnings for offer ${offer.offer.offerId}:`, offer.warnings);
          }
        });
      }

      if (response.data.errors && response.data.errors.length > 0) {
        console.error('Request errors:', response.data.errors);
      }

      return response.data;
    } catch (error) {
      console.error('Error creating offer mappings:', error);
      throw error;
    }
  }

  public async getOffersByIds(offerIds: string[]): Promise<TOffer[]> {
    try {
      if (!offerIds || offerIds.length === 0) {
        throw new Error('offerIds array cannot be empty');
      }

      console.log(
        `Fetching offers by IDs (${offerIds.length} total): ${offerIds.slice(0, 5).join(', ')}${offerIds.length > 5 ? '...' : ''}`,
      );

      const allOffers: TOffer[] = [];
      let nextPageToken: string | undefined;
      let pageCount = 0;

      do {
        pageCount++;

        // Строим URL с параметрами
        const params = new URLSearchParams();
        params.append('limit', this.MAX_LIMIT.toString()); // Максимальный лимит для пагинации

        if (nextPageToken) {
          params.append('page_token', nextPageToken);
        }

        const url = `/campaigns/${this.campaign_id}/offers?${params.toString()}`;

        console.log(`Loading offers page ${pageCount} with URL: ${url}`);

        // Тело запроса с фильтрацией по offerIds
        const requestBody = { offerIds };

        const response = await this.httpClient.post<TOffersResponse>(url, requestBody);

        const { offers, paging } = response.data?.result || {};

        if (offers && offers.length > 0) {
          allOffers.push(...offers);
          console.log(
            `Loaded ${offers.length} offers on page ${pageCount}. Total found: ${allOffers.length}`,
          );
        } else {
          console.log(`No offers found on page ${pageCount}`);
        }

        nextPageToken = paging?.nextPageToken;

        // Дополнительная защита от бесконечного цикла
        if (pageCount > 100) {
          console.warn('Breaking pagination loop: too many pages (>100)');
          break;
        }
      } while (nextPageToken);

      console.log(
        `Completed fetching offers by IDs. Pages processed: ${pageCount}, Total offers found: ${allOffers.length}`,
      );

      // Дополнительная фильтрация на клиенте для гарантии соответствия
      const filteredOffers = allOffers.filter((offer) =>
        offerIds.some((id) => id.toLowerCase() === offer.offerId.toLowerCase()),
      );

      if (filteredOffers.length !== allOffers.length) {
        console.log(
          `Filtered ${allOffers.length - filteredOffers.length} offers that didn't match requested IDs`,
        );
      }

      console.log(`Final result: ${filteredOffers.length} offers matching requested IDs`);

      return filteredOffers;
    } catch (error) {
      console.error('Error fetching offers by IDs:', error);
      throw error;
    }
  }
}
