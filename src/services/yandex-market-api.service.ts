import axios, { AxiosInstance, AxiosResponse } from 'axios';
// import { IProductData } from './excel-parser.service';

// Временная заглушка для IProductData
export interface IProductData {
  name: string;
  price: number;
  sku: string;
  quantity?: number;
}

export interface IYandexMarketConfig {
  campaign_id: string;
  business_id: string;
  token: string;
}

export interface IPriceUpdateRequest {
  offerId: string; // SKU товара
  price: {
    value: number;
    currencyId: string;
  };
}

export interface IPriceUpdateResponse {
  offerId: string;
  updated: boolean;
  errors?: string[];
}

export interface IBatchPriceUpdateResult {
  successCount: number;
  errorCount: number;
  results: IPriceUpdateResponse[];
  errors: string[];
}

export interface IOfferInfo {
  offerId: string;
  name: string;
  price?: {
    value: number;
    currencyId: string;
  };
  availability: string;
  categoryId?: number;
}

export class YandexMarketApiService {
  private axiosInstance: AxiosInstance;
  private config: IYandexMarketConfig;

  constructor(config: IYandexMarketConfig) {
    this.config = config;
    this.axiosInstance = axios.create({
      baseURL: 'https://api.partner.market.yandex.ru',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 секунд
    });

    // Добавляем interceptor для логирования
    this.axiosInstance.interceptors.request.use(
      (config) => {
        console.log(`🚀 Yandex API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ Yandex API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.axiosInstance.interceptors.response.use(
      (response) => {
        console.log(`✅ Yandex API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        console.error('❌ Yandex API Response Error:', error.response?.status, error.response?.data);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Проверка подключения к API
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.axiosInstance.get(
        `/v2/campaigns/${this.config.campaign_id}/settings`
      );
      
      return { success: true };
    } catch (error) {
      let errorMessage = 'Неизвестная ошибка';
      
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          errorMessage = 'Неверный токен авторизации';
        } else if (error.response?.status === 403) {
          errorMessage = 'Нет доступа к кампании';
        } else if (error.response?.status === 404) {
          errorMessage = 'Кампания не найдена';
        } else {
          errorMessage = error.response?.data?.message || error.message;
        }
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Получение информации о товарах
   */
  async getOffers(limit: number = 200): Promise<IOfferInfo[]> {
    try {
      const response = await this.axiosInstance.get(
        `/v2/campaigns/${this.config.campaign_id}/offers`,
        {
          params: {
            limit,
            page_token: '',
          },
        }
      );

      return response.data.result?.offers || [];
    } catch (error) {
      console.error('Ошибка получения товаров:', error);
      throw new Error('Не удалось получить список товаров');
    }
  }

  /**
   * Обновление цены одного товара
   */
  async updateSinglePrice(
    offerId: string, 
    price: number, 
    currencyId: string = 'RUR'
  ): Promise<IPriceUpdateResponse> {
    try {
      const requestData = {
        offers: [
          {
            offerId,
            price: {
              value: Math.round(price),
              currencyId,
            },
          },
        ],
      };

      const response = await this.axiosInstance.post(
        `/v2/campaigns/${this.config.campaign_id}/offers/prices`,
        requestData
      );

      const result = response.data.result?.offers?.[0];
      
      return {
        offerId,
        updated: result?.updated || false,
        errors: result?.errors || [],
      };
    } catch (error) {
      console.error(`Ошибка обновления цены для ${offerId}:`, error);
      
      return {
        offerId,
        updated: false,
        errors: [axios.isAxiosError(error) ? error.message : 'Неизвестная ошибка'],
      };
    }
  }

  /**
   * Пакетное обновление цен
   */
  async updatePricesBatch(products: IProductData[]): Promise<IBatchPriceUpdateResult> {
    const result: IBatchPriceUpdateResult = {
      successCount: 0,
      errorCount: 0,
      results: [],
      errors: [],
    };

    // Разбиваем на батчи по 50 товаров (ограничение Яндекс API)
    const batchSize = 50;
    const batches = this.chunkArray(products, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Обрабатываем батч ${i + 1}/${batches.length} (${batch.length} товаров)`);

      try {
        const batchResult = await this.processBatch(batch);
        
        result.successCount += batchResult.successCount;
        result.errorCount += batchResult.errorCount;
        result.results.push(...batchResult.results);
        
        // Задержка между батчами для соблюдения rate limits
        if (i < batches.length - 1) {
          await this.delay(1000); // 1 секунда
        }
      } catch (error) {
        result.errors.push(`Ошибка в батче ${i + 1}: ${error.message}`);
        result.errorCount += batch.length;
      }
    }

    return result;
  }

  /**
   * Обработка одного батча товаров
   */
  private async processBatch(products: IProductData[]): Promise<IBatchPriceUpdateResult> {
    const offers = products
      .filter(product => product.sku) // Только товары с SKU
      .map(product => ({
        offerId: product.sku!,
        price: {
          value: Math.round(product.price),
          currencyId: 'RUR',
        },
      }));

    if (offers.length === 0) {
      return {
        successCount: 0,
        errorCount: 0,
        results: [],
        errors: ['Нет товаров с SKU для обновления'],
      };
    }

    try {
      const response = await this.axiosInstance.post(
        `/v2/campaigns/${this.config.campaign_id}/offers/prices`,
        { offers }
      );

      const apiResults = response.data.result?.offers || [];
      const results: IPriceUpdateResponse[] = [];
      let successCount = 0;
      let errorCount = 0;

      for (const apiResult of apiResults) {
        const isSuccess = apiResult.updated && (!apiResult.errors || apiResult.errors.length === 0);
        
        results.push({
          offerId: apiResult.offerId,
          updated: isSuccess,
          errors: apiResult.errors || [],
        });

        if (isSuccess) {
          successCount++;
        } else {
          errorCount++;
        }
      }

      return {
        successCount,
        errorCount,
        results,
        errors: [],
      };
    } catch (error) {
      throw new Error(`Ошибка API: ${axios.isAxiosError(error) ? error.message : 'Неизвестная ошибка'}`);
    }
  }

  /**
   * Получение информации о конкретном товаре
   */
  async getOffer(offerId: string): Promise<IOfferInfo | null> {
    try {
      const response = await this.axiosInstance.get(
        `/v2/campaigns/${this.config.campaign_id}/offers/${encodeURIComponent(offerId)}`
      );

      return response.data.result?.offer || null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null; // Товар не найден
      }
      throw error;
    }
  }

  /**
   * Проверка существования товаров по SKU
   */
  async checkOffersExist(skus: string[]): Promise<{ existing: string[]; missing: string[] }> {
    const existing: string[] = [];
    const missing: string[] = [];

    // Проверяем по 10 товаров за раз
    const chunks = this.chunkArray(skus, 10);
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (sku) => {
        try {
          const offer = await this.getOffer(sku);
          return { sku, exists: !!offer };
        } catch (error) {
          return { sku, exists: false };
        }
      });

      const results = await Promise.all(promises);
      
      for (const result of results) {
        if (result.exists) {
          existing.push(result.sku);
        } else {
          missing.push(result.sku);
        }
      }

      // Задержка между проверками
      await this.delay(500);
    }

    return { existing, missing };
  }

  /**
   * Получение статистики обновлений
   */
  async getUpdateStats(offerId: string): Promise<{
    lastUpdated?: Date;
    updateCount?: number;
    currentPrice?: number;
  }> {
    try {
      const offer = await this.getOffer(offerId);
      
      return {
        currentPrice: offer?.price?.value,
        // Другие данные могут быть недоступны через API
      };
    } catch (error) {
      return {};
    }
  }

  /**
   * Валидация конфигурации
   */
  static validateConfig(config: IYandexMarketConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.campaign_id || !/^\d+$/.test(config.campaign_id)) {
      errors.push('Campaign ID должен быть числом');
    }

    if (!config.business_id || !/^\d+$/.test(config.business_id)) {
      errors.push('Business ID должен быть числом');
    }

    if (!config.token || config.token.length < 10) {
      errors.push('Токен должен содержать минимум 10 символов');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Разбивка массива на части
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Задержка выполнения
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Получение информации о кампании
   */
  async getCampaignInfo(): Promise<any> {
    try {
      const response = await this.axiosInstance.get(
        `/v2/campaigns/${this.config.campaign_id}`
      );
      return response.data.result;
    } catch (error) {
      throw new Error('Не удалось получить информацию о кампании');
    }
  }

  /**
   * Получение лимитов API
   */
  async getApiLimits(): Promise<{
    requests: { remaining: number; limit: number };
    daily: { remaining: number; limit: number };
  }> {
    // Эта информация обычно приходит в заголовках ответа
    // Возвращаем примерные значения
    return {
      requests: { remaining: 1000, limit: 1000 },
      daily: { remaining: 10000, limit: 10000 },
    };
  }
} 