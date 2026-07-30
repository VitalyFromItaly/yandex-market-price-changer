// private token: string = 'ACMA:bhD15nJMV71y4UZPbAFOVTZvNVGgHzkfPIH9QdWm:e0035103',
//   private compaignId = 134874104,
//   private businessId = 182608006,

import type { TParsedPriceRow } from '../../parser/domain.parser';
import type { IProcessingResult } from '../../types/yandex-market.types';
import type { ICreateOfferMapping } from '../services/offer.service';

import { HttpClient } from '../../../transport/http';
import { CampaignService } from '../services/campaign.service';
import { OfferService } from '../services/offer.service';

function capitalizeFirstLetter(string: string): string {
  if (!string) return ''; // Check for empty string
  return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

/**
 * Извлечение бренда из названия товара
 * Предполагается что offer.name имеет формат "БРЕНД модель SKU" или "БРЕНД модель"
 */
function extractBrandFromName(productName: string): string {
  if (!productName) return 'UNKNOWN';

  // Убираем лишние пробелы и разбиваем на слова
  const words = productName.trim().split(/\s+/);

  if (words.length === 0) return 'UNKNOWN';

  // Первое слово считаем брендом
  const brand = words[0];

  // Приводим к верхнему регистру и очищаем от лишних символов
  return brand.toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');
}

/**
 * Функция задержки выполнения
 * @param ms - количество миллисекунд для ожидания
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface IPriceUpdateResult {
  updated: number;
  created: number;
  zeroed: number;
  errors: Array<{
    type: string;
    batch?: number;
    error: string;
    offers?: string[];
    offerId?: string;
    errors?: any[];
  }>;
  summary: {
    totalProcessed: number;
    successfulUpdates: number;
    successfulCreations: number;
    successfulZeroing: number;
    failedOperations: number;
  };
}

/**
 * @deprecated Изменение цен по API отключено — бот переведён в read-only режим
 * (отчёты по заказам). Класс сохранён как справочный материал, из нового кода
 * не вызывать и не развивать. Единственная планируемая write-операция —
 * обновление ОСТАТКОВ (TASK-035), и её нужно писать заново, а не поверх этого.
 *
 * Известные дефекты, зафиксированы намеренно — чтобы не переехали в новый код:
 *
 * 1. Скрытая наценка `+5 ₽`. В updateExistingOffers цена считается как
 *    `Math.round(price * k * 100) / 100 + 5`, а в createNewOffers то же самое
 *    БЕЗ `+ 5`. Один и тот же SKU получает разную цену в зависимости от того,
 *    обновляется он или создаётся. Надбавка ниоткуда не сконфигурирована.
 * 2. Fallback-коэффициент `2` (см. updateOrCreateOffers) — то есть при
 *    отсутствии настройки цена УДВАИВАЛАСЬ, при том что дефолт в схеме
 *    YandexMarket и весь текст в интерфейсе говорят про 1.2.
 * 3. createNewOffers хардкодит карточку товара под часы: префикс имени
 *    «Наручные часы », заготовленное описание, vendor = первое слово названия.
 *    Для любой другой категории это мусор в карточке.
 *
 * @see OfferService — там же зафиксированы дефекты транспортного слоя.
 */
export class PriceChanger {
  private readonly campaign_id: number;
  private readonly business_id: number;

  private readonly httpClient: HttpClient;

  public readonly productsService: OfferService;

  constructor(token: string, campaign_id: number, business_id: number) {
    this.campaign_id = campaign_id;
    this.business_id = business_id;

    this.httpClient = new HttpClient({
      // ЕДИНСТВЕННОЕ оставшееся прямое чтение process.env в репозитории.
      // Оставлено намеренно: класс помечен @deprecated и не вызывается из
      // живого кода, а протаскивание сюда AppConfigService потянуло бы правки
      // в цепочку тоже deprecated-процессоров. Новый read-only клиент
      // (TASK-019) получает базовый URL через AppConfigService.
      baseURL: process.env.YANDEX_MARKET_BASE_URL,
      headers: {
        'Api-Key': `${token}`,
        'Content-Type': 'application/json',
      },
    });

    this.productsService = new OfferService(this.httpClient, this.campaign_id, this.business_id);
  }

  public async updateOrCreateOffers(data: IProcessingResult): Promise<IPriceUpdateResult> {
    const { comparison, yandexSettings } = data;

    if (!comparison || !yandexSettings) {
      throw new Error('Missing comparison data or Yandex settings');
    }

    const priceCoefficient = yandexSettings.priceCoefficient || 2;
    console.log(`🔄 Starting price update with coefficient: ${priceCoefficient}`);

    const results: IPriceUpdateResult = {
      updated: 0,
      created: 0,
      zeroed: 0,
      errors: [],
      summary: {
        totalProcessed: 0,
        successfulUpdates: 0,
        successfulCreations: 0,
        successfulZeroing: 0,
        failedOperations: 0,
      },
    };

    try {
      // Обработка товаров для обновления цен
      if (comparison.toUpdate && comparison.toUpdate.length > 0) {
        console.log(`📝 Updating prices for ${comparison.toUpdate.length} existing offers...`);
        const updateResults = await this.updateExistingOffers(
          comparison.toUpdate,
          priceCoefficient,
        );
        results.updated = updateResults.successful;
        results.errors = results.errors.concat(updateResults.errors);
        results.summary.successfulUpdates = updateResults.successful;
        results.summary.failedOperations += updateResults.failed;
      }

      // Обработка товаров для создания новых карточек
      if (comparison.toCreate && comparison.toCreate.length > 0) {
        console.log(`➕ Creating ${comparison.toCreate.length} new offer mappings...`);
        const createResults = await this.createNewOffers(comparison.toCreate, priceCoefficient);
        results.created = createResults.successful;
        results.errors = results.errors.concat(createResults.errors);
        results.summary.successfulCreations = createResults.successful;
        results.summary.failedOperations += createResults.failed;
      }

      // Обработка товаров для обнуления остатков (есть в Yandex, но нет в файле)
      if (comparison.toZeroStock && comparison.toZeroStock.length > 0) {
        console.log(
          `🔴 Zeroing stock for ${comparison.toZeroStock.length} offers not present in file...`,
        );
        const zeroResults = await this.zeroStockForMissingOffers(comparison.toZeroStock);
        results.zeroed = zeroResults.successful;
        results.errors = results.errors.concat(zeroResults.errors);
        results.summary.successfulZeroing = zeroResults.successful;
        results.summary.failedOperations += zeroResults.failed;
      }

      results.summary.totalProcessed =
        comparison.toUpdate.length + comparison.toCreate.length + comparison.toZeroStock.length;

      console.log('✅ Price update completed:');
      console.log(`   • Updated: ${results.updated} offers`);
      console.log(`   • Created: ${results.created} offers`);
      console.log(`   • Zeroed: ${results.zeroed} offers`);
      console.log(`   • Errors: ${results.errors.length}`);

      return results;
    } catch (error) {
      console.error('❌ Error in updateOrCreateOffers:', error);
      throw error;
    }
  }

  /**
   * Обновление цен существующих товаров
   */
  private async updateExistingOffers(
    offers: TParsedPriceRow[],
    priceCoefficient: number,
  ): Promise<{
    successful: number;
    failed: number;
    errors: Array<{ type: string; batch?: number; error: string; offers?: string[] }>;
  }> {
    const errors: Array<{ type: string; batch?: number; error: string; offers?: string[] }> = [];
    let successful = 0;
    let failed = 0;

    try {
      // Подготавливаем данные для обновления цен
      const updateOffers = offers.map((offer) => ({
        offerId: offer.sku,
        price: {
          value: Math.round(offer.price * priceCoefficient * 100) / 100 + 5, // Округляем до копеек
          currencyId: 'RUR' as const,
        },
      }));

      // Подготавливаем данные для обновления остатков
      const updateStocks = {
        skus: offers.map((offer) => ({
          sku: offer.sku,
          items: [
            {
              count: offer.count || 0,
            },
          ],
        })),
      };

      console.log({ updateOffers });

      console.log(`📊 Prepared ${updateOffers.length} offers for price update`);
      console.log(`📊 Prepared ${updateStocks.skus.length} offers for stock update`);
      console.log('Sample update data:', updateOffers.slice(0, 2));
      console.log('Sample stock data:', updateStocks.skus.slice(0, 2));

      // Разбиваем на батчи по 50 товаров (ограничение API)
      const priceBatches = this.chunkArray(updateOffers, 50);
      const stockSkuBatches = this.chunkArray(updateStocks.skus, 50);

      for (let i = 0; i < priceBatches.length; i++) {
        const priceBatch = priceBatches[i];
        const stockSkuBatch = stockSkuBatches[i];
        console.log(
          `🔄 Processing batch ${i + 1}/${priceBatches.length} (${priceBatch.length} offers)`,
        );

        try {
          // Параллельно обновляем цены и остатки
          const [priceResult, stockResult] = await Promise.allSettled([
            this.productsService.updateOfferPrice({ offers: priceBatch }),
            this.productsService.updateOfferStock({ skus: stockSkuBatch }),
          ]);

          let batchSuccessful = 0;
          let batchFailed = 0;

          // Проверяем результат обновления цен
          if (priceResult.status === 'fulfilled') {
            console.log(`✅ Price update for batch ${i + 1} completed successfully`);
            batchSuccessful++;
          } else {
            console.error(`❌ Price update failed for batch ${i + 1}:`, priceResult.reason);
            errors.push({
              type: 'batch_price_update_error',
              batch: i + 1,
              error: priceResult.reason.message || priceResult.reason,
              offers: priceBatch.map((o) => o.offerId),
            });
            batchFailed++;
          }

          // Проверяем результат обновления остатков
          if (stockResult.status === 'fulfilled') {
            console.log(`✅ Stock update for batch ${i + 1} completed successfully`);
            batchSuccessful++;
          } else {
            console.error(`❌ Stock update failed for batch ${i + 1}:`, stockResult.reason);
            errors.push({
              type: 'batch_stock_update_error',
              batch: i + 1,
              error: stockResult.reason.message || stockResult.reason,
              offers: stockSkuBatch.map((o) => o.sku),
            });
            batchFailed++;
          }

          // Считаем успешными только если оба запроса прошли успешно
          if (priceResult.status === 'fulfilled' && stockResult.status === 'fulfilled') {
            successful += priceBatch.length;
            console.log(`✅ Batch ${i + 1} completed successfully (both price and stock)`);
          } else {
            failed += priceBatch.length;
            console.log(`⚠️ Batch ${i + 1} partially failed`);
          }

          // Задержка между батчами
          if (i < priceBatches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (batchError) {
          console.error(`❌ Error in batch ${i + 1}:`, batchError);
          failed += priceBatch.length;
          errors.push({
            type: 'batch_update_error',
            batch: i + 1,
            error: (batchError as Error).message || String(batchError),
            offers: priceBatch.map((o) => o.offerId),
          });
        }
      }
    } catch (error) {
      console.error('❌ Error updating existing offers:', error);
      failed += offers.length;
      errors.push({
        type: 'update_preparation_error',
        error: (error as Error).message || String(error),
      });
    }

    return { successful, failed, errors };
  }

  /**
   * Создание новых карточек товаров
   * После создания карточек ожидает 7 секунд для их полной обработки системой Yandex Market
   * перед обновлением остатков
   */
  private async createNewOffers(
    offers: TParsedPriceRow[],
    priceCoefficient: number,
  ): Promise<{
    successful: number;
    failed: number;
    errors: Array<{
      type: string;
      batch?: number;
      error: string;
      offers?: string[];
      offerId?: string;
      errors?: any[];
    }>;
  }> {
    const errors: Array<{
      type: string;
      batch?: number;
      error: string;
      offers?: string[];
      offerId?: string;
      errors?: any[];
    }> = [];
    let successful = 0;
    let failed = 0;

    try {
      console.log(`📦 Preparing ${offers.length} offers for creation...`);

      // Подготавливаем данные для создания карточек
      const createOffers = offers.map((offer) => {
        const detectedBrand = extractBrandFromName(offer.name);

        const offerData = {
          offerId: offer.sku,
          name: 'Наручные часы ' + offer.name,
          vendor: detectedBrand, // Бренд товара (извлекается из названия)
          basicPrice: {
            value: Math.round(offer.price * priceCoefficient * 100) / 100, // Округляем до копеек
            currencyId: 'RUR' as const,
          },
          vendorCode: offer.sku,
          description: `Качественные наручные часы ${offer.name}. Бренд ${detectedBrand}. Оригинальная продукция с гарантией качества.`,
          barcodes: [offer.sku],
          count: offer.count || 0, // Количество товара, если не указано - 1 по умолчанию
        };

        // Изображения не используются

        return { offer: offerData };
      });

      console.log(`📊 Prepared ${createOffers.length} offers for creation`);
      console.log('Sample create data:', createOffers.slice(0, 2));

      // Разбиваем на батчи по 100 товаров (ограничение API для создания)
      const batches = this.chunkArray(createOffers, 100);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(
          `🔄 Processing creation batch ${i + 1}/${batches.length} (${batch.length} offers)`,
        );

        try {
          const response = await this.productsService.createOfferMappings(
            batch as ICreateOfferMapping[],
          );

          // Анализируем результат создания
          if (response.status === 'OK') {
            // При успешном создании считаем все товары в батче успешными
            const batchSuccessful = batch.length;
            const batchFailed = 0;

            successful += batchSuccessful;

            console.log(
              `✅ Creation batch ${i + 1} completed: ${batchSuccessful} successful, ${batchFailed} failed`,
            );

            // Если есть успешно созданные товары, обновляем их остатки
            if (batchSuccessful > 0) {
              try {
                // Подготавливаем данные для обновления остатков только успешно созданных товаров
                const stocksToUpdate = {
                  skus: batch.map((offerMapping) => {
                    return {
                      sku: offerMapping.offer.offerId,
                      items: [
                        {
                          count: offerMapping.offer?.count || 0, // Используем количество из файла или 1 по умолчанию
                          updatedAt: new Date().toISOString(),
                        },
                      ],
                    };
                  }),
                };

                console.log(
                  `📤 Sending stock update request with ${stocksToUpdate.skus.length} items:`,
                );
                console.log('Stock update data:', JSON.stringify(stocksToUpdate, null, 2));

                // Обновляем остатки для успешно созданных товаров
                console.log({ stocksToUpdate });
                const stockResponse = await this.productsService.updateOfferStock(stocksToUpdate);
                console.log(
                  `✅ Stock update completed for batch ${i + 1}. Response:`,
                  stockResponse,
                );
              } catch (stockError) {
                console.error(`❌ Error updating stocks for batch ${i + 1}:`, stockError);
                console.error('Stock error details:', {
                  message: (stockError as Error).message,
                  stack: (stockError as Error).stack,
                  response: (stockError as any)?.response?.data,
                });
                errors.push({
                  type: 'batch_stock_update_after_creation_error',
                  batch: i + 1,
                  error: (stockError as Error).message || String(stockError),
                  offers: batch.map((o) => o.offer.offerId),
                });
              }
            } else {
              console.log(`⚠️ No successful offers in batch ${i + 1} to update stocks for`);
            }
          } else {
            // Если статус не OK, считаем весь батч неуспешным
            const batchFailed = batch.length;
            failed += batchFailed;

            console.log(`❌ Creation batch ${i + 1} failed: status = ${response.status}`);

            errors.push({
              type: 'batch_creation_failed',
              batch: i + 1,
              error: `Batch creation failed with status: ${response.status}`,
              offers: batch.map((o) => o.offer.offerId),
            });
          }

          // Задержка между батчами
          if (i < batches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Увеличиваем задержку для создания
          }
        } catch (batchError) {
          console.error(`❌ Error in creation batch ${i + 1}:`, batchError);
          failed += batch.length;
          errors.push({
            type: 'batch_creation_error',
            batch: i + 1,
            error: (batchError as Error).message || String(batchError),
            offers: batch.map((o) => o.offer.offerId),
          });
        }
      }
    } catch (error) {
      console.error('❌ Error creating new offers:', error);
      failed += offers.length;
      errors.push({
        type: 'creation_preparation_error',
        error: (error as Error).message || String(error),
      });
    }

    return { successful, failed, errors };
  }

  /**
   * Обнуление остатков для товаров, которые есть в Yandex, но отсутствуют в файле
   */
  private async zeroStockForMissingOffers(yandexOffers: any[]): Promise<{
    successful: number;
    failed: number;
    errors: Array<{ type: string; batch?: number; error: string; offers?: string[] }>;
  }> {
    const errors: Array<{ type: string; batch?: number; error: string; offers?: string[] }> = [];
    let successful = 0;
    let failed = 0;

    try {
      // Подготавливаем данные для обнуления остатков
      const zeroStocks = {
        skus: yandexOffers.map((offer) => ({
          sku: offer.offerId,
          items: [
            {
              count: 0,
              updatedAt: new Date().toISOString(),
            },
          ],
        })),
      };

      console.log(`📊 Prepared ${zeroStocks.skus.length} offers for stock zeroing`);
      console.log('Sample zero stock data:', zeroStocks.skus.slice(0, 3));

      // Разбиваем на батчи по 50 товаров (ограничение API)
      const stockBatches = this.chunkArray(zeroStocks.skus, 50);

      for (let i = 0; i < stockBatches.length; i++) {
        const batch = stockBatches[i];
        console.log(
          `🔄 Processing zeroing batch ${i + 1}/${stockBatches.length} (${batch.length} offers)`,
        );

        try {
          const stockResult = await this.productsService.updateOfferStock({ skus: batch });
          console.log(`✅ Stock zeroing for batch ${i + 1} completed successfully`);
          successful += batch.length;

          // Задержка между батчами
          if (i < stockBatches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (batchError) {
          console.error(`❌ Error zeroing stocks in batch ${i + 1}:`, batchError);
          failed += batch.length;
          errors.push({
            type: 'batch_zero_stock_error',
            batch: i + 1,
            error: (batchError as Error).message || String(batchError),
            offers: batch.map((o) => o.sku),
          });
        }
      }
    } catch (error) {
      console.error('❌ Error zeroing stocks for missing offers:', error);
      failed += yandexOffers.length;
      errors.push({
        type: 'zero_stock_preparation_error',
        error: (error as Error).message || String(error),
      });
    }

    return { successful, failed, errors };
  }

  /**
   * Разбивка массива на батчи
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
