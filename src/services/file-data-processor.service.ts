import { SimplePriceListParser } from '../modules/parser/simple-parser';
import { TParsedPriceRow } from '../modules/parser/domain.parser';
import { PriceChanger } from '../modules/yandex/handlers/price.changer.handler';
import { YandexMarketService } from '../database/mongo/services/yandex-market.service';
import { IYandexMarketSchema } from '../database/mongo/models/yandex-market.model.mongo';

export interface IFileInfo {
  filename: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  uploadedAt: Date;
}

export interface IParsingResult {
  success: boolean;
  data: TParsedPriceRow[];
  uniqueSkus: string[];
  totalItems: number;
  error?: string;
}

export interface IYandexApiResult {
  success: boolean;
  offers: any[];
  processedBatches: number;
  totalRequested: number;
  error?: string;
}

export interface IComparisonResult {
  matched: number;
  priceMatches: number;
  priceMismatches: number;
  onlyInParser: number;
  onlyInYandex: number;
  matchPercentage: number;
  toUpdate: TParsedPriceRow[];  // Товары для обновления (найдены в Yandex)
  toCreate: TParsedPriceRow[];  // Товары для создания (не найдены в Yandex)
  toZeroStock: any[];           // Товары из Yandex, которых нет в файле (обнулить остатки)
}

export interface IProcessingResult {
  fileInfo: IFileInfo;
  parsing: IParsingResult;
  yandexApi?: IYandexApiResult;
  comparison?: IComparisonResult;
  yandexSettings?: IYandexMarketSchema;
  hasApiSettings: boolean;
}

export class FileDataProcessorService {
  private static readonly BATCH_SIZE = 50;
  private static readonly BATCH_DELAY_MS = 1000;

  /**
   * Основной метод обработки файла
   */
  static async processFile(
    fileInfo: IFileInfo,
    userId: string,
    progressCallback?: (step: string, details?: string) => Promise<void>
  ): Promise<IProcessingResult> {
    const result: IProcessingResult = {
      fileInfo,
      parsing: { success: false, data: [], uniqueSkus: [], totalItems: 0 },
      hasApiSettings: false
    };

    try {
      // Шаг 1: Парсинг файла
      if (progressCallback) {
        await progressCallback('📊 Парсинг файла...');
      }

      result.parsing = await this.parseFile(fileInfo.filePath);

      if (!result.parsing.success) {
        return result;
      }

      // Краткие результаты парсинга
      if (progressCallback) {
        await progressCallback(
          `✅ Найдено ${result.parsing.totalItems} товаров (${result.parsing.uniqueSkus.length} уникальных SKU)`
        );
      }

      const yandexSettings = await YandexMarketService.getByTelegramUser(userId);
      result.yandexSettings = yandexSettings || undefined;
      result.hasApiSettings = yandexSettings?.isConfigured() || false;

      if (!result.hasApiSettings) {
        return result;
      }

      // Запрос данных из Yandex Market API
      if (progressCallback) {
        await progressCallback('🛒 Запрос данных из Yandex Market...');
      }

      result.yandexApi = await this.fetchYandexData(
        result.parsing.uniqueSkus,
        yandexSettings!,
        progressCallback
      );

      if (!result.yandexApi.success) {
        return result;
      }

      // Показываем результаты API запроса
      if (progressCallback) {
        await progressCallback(
          `✅ Получено ${result.yandexApi.offers.length} товаров из Yandex Market`
        );
      }

      result.comparison = this.compareData(result.parsing.data, result.yandexApi.offers);

      // Логируем результаты разделения данных
      console.log('📊 Результаты разделения данных:');
      console.log(`✅ Товары для обновления: ${result.comparison.toUpdate.length}`);
      console.log(`➕ Товары для создания: ${result.comparison.toCreate.length}`);
      console.log(`🔴 Товары для обнуления остатков: ${result.comparison.toZeroStock.length}`);
      console.log(`📈 Процент совпадений: ${result.comparison.matchPercentage.toFixed(1)}%`);

      return result;

    } catch (error) {
      console.error('❌ Error in FileDataProcessorService.processFile:', error);
      result.parsing.error = error instanceof Error ? error.message : 'Unknown error';
      return result;
    }
  }

  /**
   * Парсинг файла и извлечение данных
   */
  private static async parseFile(filePath: string): Promise<IParsingResult> {
    try {
      const parser = new SimplePriceListParser(filePath);
      const parsedData = await parser.parseToFlatList();

      const allSkus = parsedData
        .map(item => item.sku)
        .filter(sku => sku && sku.trim().length > 0);

      const uniqueSkus = [...new Set(allSkus)];

      return {
        success: true,
        data: parsedData,
        uniqueSkus,
        totalItems: parsedData.length
      };

    } catch (error) {
      console.error('❌ Error parsing file:', error);
      return {
        success: false,
        data: [],
        uniqueSkus: [],
        totalItems: 0,
        error: error instanceof Error ? error.message : 'Unknown parsing error'
      };
    }
  }

  /**
   * Получение данных из Yandex Market API
   * Получает ВСЕ товары из Яндекса для корректного сравнения
   */
  private static async fetchYandexData(
    skus: string[],
    yandexSettings: IYandexMarketSchema,
    progressCallback?: (step: string, details?: string) => Promise<void>,
  ): Promise<IYandexApiResult> {
    try {
      const priceChanger = new PriceChanger(
        yandexSettings.token,
        Number(yandexSettings.campaign_id),
        Number(yandexSettings.business_id)
      );

      // Получаем ВСЕ товары из Yandex Market для корректного сравнения
      if (progressCallback) {
        await progressCallback('🔄 Загрузка всех товаров из Yandex Market...');
      }

      const allOffers = await priceChanger.productsService.loadAllOffers();

      if (progressCallback) {
        await progressCallback(`✅ Загружено ${allOffers.length} товаров из Yandex Market`);
      }

      return {
        success: true,
        offers: allOffers,
        processedBatches: 1,
        totalRequested: allOffers.length
      };

    } catch (error) {
      console.error('❌ Error fetching Yandex data:', error);
      return {
        success: false,
        offers: [],
        processedBatches: 0,
        totalRequested: 0,
        error: error instanceof Error ? error.message : 'Unknown API error'
      };
    }
  }

  /**
   * Сравнение данных парсера с данными Yandex API
   */
  private static compareData(parsedData: TParsedPriceRow[], yandexOffers: any[]): IComparisonResult {
    const yandexMap = new Map();
    yandexOffers.forEach(offer => {
      yandexMap.set(offer.offerId?.toLowerCase(), offer);
    });

    // Создаем карту SKU из файла для быстрого поиска
    const fileSkuMap = new Set();
    parsedData.forEach(item => {
      if (item.sku) {
        fileSkuMap.add(item.sku.toLowerCase());
      }
    });

    const result: IComparisonResult = {
      matched: 0,
      priceMatches: 0,
      priceMismatches: 0,
      onlyInParser: 0,
      onlyInYandex: 0,
      matchPercentage: 0,
      toUpdate: [],
      toCreate: [],
      toZeroStock: []
    };

    // Анализируем товары из парсера
    parsedData.forEach(item => {
      const yandexOffer = yandexMap.get(item.sku?.toLowerCase());

      if (yandexOffer) {
        // Товар найден в Yandex - добавляем в список для обновления
        result.matched++;
        result.toUpdate.push(item);

        const parserPrice = item.price;
        const yandexPrice = yandexOffer.basicPrice?.value || 0;

        if (Math.abs(parserPrice - yandexPrice) < 0.01) {
          result.priceMatches++;
        } else {
          result.priceMismatches++;
        }
      } else {
        // Товар не найден в Yandex - добавляем в список для создания
        result.onlyInParser++;
        result.toCreate.push(item);
      }
    });

    // Находим товары, которые есть в Yandex, но отсутствуют в файле
    // Для таких товаров нужно обнулить остатки
    yandexOffers.forEach(yandexOffer => {
      if (!fileSkuMap.has(yandexOffer.offerId?.toLowerCase())) {
        result.toZeroStock.push(yandexOffer);
      }
    });

    // Считаем товары только в Yandex
    result.onlyInYandex = result.toZeroStock.length;

    // Вычисляем процент совпадений
    const uniqueSkusCount = new Set(parsedData.map(item => item.sku?.toLowerCase())).size;
    result.matchPercentage = uniqueSkusCount > 0 ? (result.matched / uniqueSkusCount) * 100 : 0;

    console.log('📊 Детальный анализ сравнения:');
    console.log(`   • Товары в файле: ${parsedData.length}`);
    console.log(`   • Товары в Yandex: ${yandexOffers.length}`);
    console.log(`   • Совпадения: ${result.matched}`);
    console.log(`   • Для создания: ${result.toCreate.length}`);
    console.log(`   • Для обнуления остатков: ${result.toZeroStock.length}`);

    return result;
  }

  /**
   * Получение примеров товаров для предварительного просмотра
   */
  static getDataPreview(parsedData: TParsedPriceRow[], limit: number = 3): Array<{
    index: number;
    name: string;
    sku: string;
    price: number;
    count: number;
  }> {
    return parsedData.slice(0, limit).map((item, index) => ({
      index: index + 1,
      name: item.name,
      sku: item.sku,
      price: item.price,
      count: item.count
    }));
  }

  /**
   * Разбивает массив на батчи
   */
  private static chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Форматирование процента
   */
  static formatPercentage(value: number): string {
    return value.toFixed(1);
  }

  /**
   * Форматирование цены
   */
  static formatPrice(price: number): string {
    return price.toFixed(2);
  }
}
