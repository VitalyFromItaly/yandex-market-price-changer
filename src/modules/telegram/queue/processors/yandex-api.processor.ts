import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { 
  FetchYandexDataJobData, 
  UpdateYandexOffersJobData,
  FileProcessingService 
} from '../services/file-processing.service';
import { FileDataProcessorService } from '../../services/file-data-processor.service';
import { FileUploadService } from '../../services/file-upload.service';
import { PriceChanger } from '../../../yandex/handlers/price.changer.handler';
import { YandexMarketService } from '../../../../database/services';
import { QUEUE_NAMES, JOB_TYPES } from '../../index';

@Injectable()
@Processor(QUEUE_NAMES.YANDEX_API)
export class YandexApiProcessor {
  constructor(
    private readonly yandexMarketService: YandexMarketService,
    private readonly fileDataProcessorService: FileDataProcessorService,
    private readonly fileProcessingService: FileProcessingService,
  ) {}

  @Process({ name: JOB_TYPES.FETCH_YANDEX_DATA, concurrency: 3 })
  async handleFetchYandexData(job: Job<FetchYandexDataJobData>) {
    const { userId, chatId, parsingResult, botToken, sessionId } = job.data;
    
    try {
      await job.progress(10);
      await this.fileProcessingService.addProgressNotification({
        botToken,
        chatId,
        message: '🔄 Получение данных из Yandex Market...',
        step: 'Получение данных из Yandex Market...',
        sessionId,
      });

      const yandexSettings = await this.yandexMarketService.findByTelegramUser(userId);
      if (!yandexSettings) {
        throw new Error('Настройки Yandex Market не найдены');
      }

      const yandexApiResult = await this.fileDataProcessorService.fetchYandexData(
        yandexSettings,
        async (step: string, details?: string) => {
          console.log(`[Queue] Yandex API step: ${step}`, details);
          await this.fileProcessingService.addProgressNotification({
            botToken,
            chatId,
            message: `🔄 ${step}`,
            step,
            details,
            sessionId,
          });
        },
      );

      await job.progress(80);

      if (!yandexApiResult.success) {
        throw new Error(yandexApiResult.error || 'Ошибка получения данных из Yandex Market');
      }

      // Запускаем сравнение данных
      await this.fileProcessingService.addCompareDataJob({
        userId,
        chatId,
        parsingResult,
        yandexApiResult,
        botToken,
        sessionId,
      });

      await job.progress(100);
      return { success: true, yandexApiResult };
    } catch (error) {
      console.error('❌ Error fetching Yandex data:', error);
      await this.fileProcessingService.addErrorNotification({
        botToken,
        chatId,
        message: `❌ Произошла ошибка при получении данных из Yandex Market:\n\n${error.message}`,
        error: error.message,
      });
      throw error;
    }
  }

  @Process({ name: JOB_TYPES.UPDATE_YANDEX_OFFERS, concurrency: 3 })
  async handleUpdateYandexOffers(job: Job<UpdateYandexOffersJobData>) {
    const { userId, chatId, processingResult, botToken, sessionId } = job.data;
    
    try {
      await job.progress(10);
      await this.fileProcessingService.addProgressNotification({
        botToken,
        chatId,
        message: '🔄 Обновление данных в Yandex Market...',
        step: 'Обновление данных в Yandex Market...',
        sessionId,
      });

      const yandexSettings = processingResult.yandexSettings;
      if (!yandexSettings) {
        throw new Error('Настройки Yandex Market не найдены');
      }

      const priceChanger = new PriceChanger(
        yandexSettings.token,
        Number(yandexSettings.campaign_id),
        Number(yandexSettings.business_id),
      );

      await job.progress(30);

      const results = await priceChanger.updateOrCreateOffers(processingResult);

      await job.progress(90);

      await this.fileProcessingService.addCompletionNotification({
        botToken,
        chatId,
        message: 'Обработка завершена!',
        results,
        priceCoefficient: yandexSettings.priceCoefficient || 2,
      });

      // Удаляем временный файл (если он есть)
      if (processingResult.fileInfo.filePath) {
        await FileUploadService.deleteFile(processingResult.fileInfo.filePath);
      }

      await job.progress(100);
      return { success: true, results };
    } catch (error) {
      console.error('❌ Error updating Yandex offers:', error);
      await this.fileProcessingService.addErrorNotification({
        botToken,
        chatId,
        message: `❌ Произошла ошибка при обновлении данных в Yandex Market:\n\n${error.message}`,
        error: error.message,
      });
      throw error;
    }
  }
} 