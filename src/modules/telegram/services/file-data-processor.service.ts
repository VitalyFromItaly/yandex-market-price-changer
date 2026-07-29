import { Injectable } from '@nestjs/common';

import { YandexMarketDocument } from '../../../database/schemas';
import { YandexMarketService } from '../../../database/services';
import { TParsedPriceRow } from '../../parser/domain.parser';
import { SimplePriceListParser } from '../../parser/simple-parser';
import { IFileInfo, IParsingResult, IProcessingResult } from '../../types/yandex-market.types';
import { PriceChanger } from '../../yandex/handlers/price.changer.handler';

/**
 * @deprecated Разбор прайс-листа и сравнение с товарами Маркета для
 * отключённого изменения цен. Из нового кода не вызывать.
 *
 * Известный дефект: в compareData сравнение цен читает `yandexOffer.price?.value`,
 * тогда как в ответе Маркета поле называется `basicPrice` (см. yandex.domain.ts).
 * В результате priceMatches всегда 0, а priceMismatches считает совпадения как
 * расхождения. На состав toUpdate это не влияло, поэтому дефект и не заметили —
 * он портил только статистику в отчёте.
 */
@Injectable()
export class FileDataProcessorService {
  constructor(private yandexMarketService: YandexMarketService) {}

  public async processFile(
    fileInfo: IFileInfo,
    userId: string,
    progressCallback?: (step: string, details?: string) => Promise<void>,
  ): Promise<IProcessingResult> {
    const result: IProcessingResult = {
      fileInfo,
      parsing: { success: false, data: [], uniqueSkus: [], totalItems: 0 },
      hasApiSettings: false,
    };
    const yandexSettings = await this.yandexMarketService.findByTelegramUser(userId);
    result.yandexSettings = yandexSettings || undefined;
    result.hasApiSettings =
      !!yandexSettings && (await this.yandexMarketService.isConfigured(userId));
    if (!result.hasApiSettings) {
      if (progressCallback) {
        await progressCallback('API settings are missing.');
      }
      return result;
    }
    try {
      result.parsing = await this.parseFile(fileInfo.filePath, progressCallback);
      if (!result.parsing.success) {
        return result;
      }
      result.yandexApi = await this.fetchYandexData(yandexSettings!, progressCallback);
      if (!result.yandexApi.success) {
        return result;
      }
      result.comparison = this.compareData(result.parsing.data, result.yandexApi.offers);
      return result;
    } catch (error) {
      console.error('Error in FileDataProcessorService.processFile:', error);
      result.parsing.error = error instanceof Error ? error.message : 'Unknown error';
      return result;
    }
  }

  public async parseFile(
    filePath: string,
    progressCallback?: (step: string, details?: string) => Promise<void>,
  ): Promise<IParsingResult> {
    if (progressCallback) await progressCallback('Parsing file...');
    try {
      const parser = new SimplePriceListParser(filePath);
      const parsedData = await parser.parseToFlatList();
      const uniqueSkus = [...new Set(parsedData.map((item) => item.sku).filter(Boolean))];
      const result = {
        success: true,
        data: parsedData,
        uniqueSkus,
        totalItems: parsedData.length,
      };
      if (progressCallback) await progressCallback(`Found ${result.totalItems} items.`);
      return result;
    } catch (error) {
      console.error('Error parsing file:', error);
      return {
        success: false,
        data: [],
        uniqueSkus: [],
        totalItems: 0,
        error: error instanceof Error ? error.message : 'Unknown parsing error',
      };
    }
  }

  public async fetchYandexData(
    yandexSettings: YandexMarketDocument,
    progressCallback?: (step: string, details?: string) => Promise<void>,
  ): Promise<any> {
    if (progressCallback) await progressCallback('Fetching data from Yandex Market...');
    try {
      const priceChanger = new PriceChanger(
        yandexSettings.token,
        Number(yandexSettings.campaign_id),
        Number(yandexSettings.business_id),
      );
      const offers = await priceChanger.productsService.loadAllOffers();
      if (progressCallback)
        await progressCallback(`Loaded ${offers.length} offers from Yandex Market.`);
      return {
        success: true,
        offers,
        processedBatches: 1,
        totalRequested: offers.length,
      };
    } catch (error) {
      console.error('Error fetching Yandex data:', error);
      return {
        success: false,
        offers: [],
        processedBatches: 0,
        totalRequested: 0,
        error: error instanceof Error ? error.message : 'Unknown API error',
      };
    }
  }

  public compareData(parsedData: TParsedPriceRow[], yandexOffers: any[]): any {
    const yandexMap = new Map(yandexOffers.map((offer) => [offer.offerId?.toLowerCase(), offer]));
    const fileSkuMap = new Set(parsedData.map((item) => item.sku?.toLowerCase()));

    const result = {
      matched: 0,
      priceMatches: 0,
      priceMismatches: 0,
      onlyInParser: 0,
      onlyInYandex: 0,
      matchPercentage: 0,
      toUpdate: [],
      toCreate: [],
      toZeroStock: yandexOffers.filter((offer) => !fileSkuMap.has(offer.offerId?.toLowerCase())),
    };

    for (const item of parsedData) {
      const yandexOffer = yandexMap.get(item.sku?.toLowerCase());
      if (yandexOffer) {
        result.matched++;
        result.toUpdate.push(item);
        if (yandexOffer.price?.value === item.price) {
          result.priceMatches++;
        } else {
          result.priceMismatches++;
        }
      } else {
        result.onlyInParser++;
        result.toCreate.push(item);
      }
    }

    result.onlyInYandex = yandexOffers.length - result.matched;
    result.matchPercentage =
      yandexOffers.length > 0 ? (result.matched / yandexOffers.length) * 100 : 0;

    return result;
  }
}
