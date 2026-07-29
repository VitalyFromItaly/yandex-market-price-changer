import { Process, Processor } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Job } from 'bull';
import { v4 as uuidv4 } from 'uuid';

import { YandexMarketService } from '../../../../database/services';
import { IProcessingResult } from '../../../types/yandex-market.types';
import { QUEUE_NAMES, JOB_TYPES } from '../../index';
import { FileDataProcessorService } from '../../services/file-data-processor.service';
import { FileUploadService } from '../../services/file-upload.service';
import {
  FileProcessingJobData,
  ParseFileJobData,
  CompareDataJobData,
  FileProcessingService,
} from '../services/file-processing.service';

/**
 * @deprecated Все три обработчика этого процессора (PROCESS_FILE, PARSE_FILE,
 * COMPARE_DATA) обслуживают отключённое изменение цен. Джобы в эту очередь
 * больше не ставятся: приём документа снят в TASK-009.
 *
 * Дефект, который нельзя повторить при возврате загрузки под остатки
 * (TASK-035): обработчик PARSE_FILE передаёт дальше fileInfo с `filePath: ''`,
 * из-за чего YandexApiProcessor не может удалить временный файл на успешном
 * пути — его условие `if (filePath)` никогда не срабатывает.
 */
@Injectable()
@Processor(QUEUE_NAMES.FILE_PROCESSING)
export class FileProcessingProcessor {
  constructor(
    private readonly yandexMarketService: YandexMarketService,
    private readonly fileDataProcessorService: FileDataProcessorService,
    private readonly fileProcessingService: FileProcessingService,
  ) {}

  @Process({ name: JOB_TYPES.PROCESS_FILE, concurrency: 3 })
  async handleFileProcessing(job: Job<FileProcessingJobData>) {
    const { userId, chatId, fileInfo, botToken } = job.data;
    const sessionId = uuidv4();

    try {
      await job.progress(10);

      // Проверяем настройки API
      const yandexMarketModel = await this.yandexMarketService.findByTelegramUser(userId);
      if (!yandexMarketModel || !(await this.yandexMarketService.isConfigured(userId))) {
        throw new Error('Настройки Yandex Market не найдены или не настроены');
      }

      await this.fileProcessingService.addProgressNotification({
        botToken,
        chatId,
        message: '🔄 Запуск обработки файла...',
        step: 'Запуск обработки файла...',
        sessionId,
      });

      // Запускаем парсинг файла
      await this.fileProcessingService.addParseFileJob({
        userId,
        chatId,
        fileInfo,
        botToken,
        sessionId,
      });

      await job.progress(20);
      return { success: true, sessionId };
    } catch (error) {
      console.error('❌ Error starting file processing:', error);
      await this.fileProcessingService.addErrorNotification({
        botToken,
        chatId,
        message: `❌ Произошла ошибка при запуске обработки файла:\n\n${error.message}`,
        error: error.message,
      });
      await FileUploadService.deleteFile(fileInfo.filePath);
      throw error;
    }
  }

  @Process({ name: JOB_TYPES.PARSE_FILE, concurrency: 3 })
  async handleParseFile(job: Job<ParseFileJobData>) {
    const { userId, chatId, fileInfo, botToken, sessionId } = job.data;

    try {
      await job.progress(10);
      await this.fileProcessingService.addProgressNotification({
        botToken,
        chatId,
        message: '🔄 Парсинг файла...',
        step: 'Парсинг файла...',
        sessionId,
      });

      const parsingResult = await this.fileDataProcessorService.parseFile(
        fileInfo.filePath,
        async (step: string, details?: string) => {
          console.log(`[Queue] Parsing step: ${step}`, details);
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

      if (!parsingResult.success) {
        throw new Error(parsingResult.error || 'Ошибка парсинга файла');
      }

      // Запускаем получение данных из Яндекса
      await this.fileProcessingService.addFetchYandexDataJob({
        userId,
        chatId,
        parsingResult,
        botToken,
        sessionId,
      });

      await job.progress(100);
      return { success: true, parsingResult };
    } catch (error) {
      console.error('❌ Error parsing file:', error);
      await this.fileProcessingService.addErrorNotification({
        botToken,
        chatId,
        message: `❌ Произошла ошибка при парсинге файла:\n\n${error.message}`,
        error: error.message,
      });
      await FileUploadService.deleteFile(fileInfo.filePath);
      throw error;
    }
  }

  @Process({ name: JOB_TYPES.COMPARE_DATA, concurrency: 3 })
  async handleCompareData(job: Job<CompareDataJobData>) {
    const { userId, chatId, parsingResult, yandexApiResult, botToken, sessionId } = job.data;

    try {
      await job.progress(10);
      await this.fileProcessingService.addProgressNotification({
        botToken,
        chatId,
        message: '🔄 Сравнение данных...',
        step: 'Сравнение данных...',
        sessionId,
      });

      const yandexSettings = await this.yandexMarketService.findByTelegramUser(userId);
      if (!yandexSettings) {
        throw new Error('Настройки Yandex Market не найдены');
      }

      const comparison = this.fileDataProcessorService.compareData(
        parsingResult.data,
        yandexApiResult.offers,
      );

      await job.progress(60);

      // Создаем результат обработки
      const processingResult: IProcessingResult = {
        fileInfo: {
          filename: `session-${sessionId}`,
          originalName: 'processed-file',
          filePath: '',
          fileSize: 0,
          uploadedAt: new Date(),
        },
        parsing: parsingResult,
        yandexApi: yandexApiResult,
        comparison,
        yandexSettings,
        hasApiSettings: true,
      };

      // Запускаем обновление данных в Яндексе
      await this.fileProcessingService.addUpdateYandexOffersJob({
        userId,
        chatId,
        processingResult,
        botToken,
        sessionId,
      });

      await job.progress(100);
      return { success: true, comparison };
    } catch (error) {
      console.error('❌ Error comparing data:', error);
      await this.fileProcessingService.addErrorNotification({
        botToken,
        chatId,
        message: `❌ Произошла ошибка при сравнении данных:\n\n${error.message}`,
        error: error.message,
      });
      throw error;
    }
  }
}
