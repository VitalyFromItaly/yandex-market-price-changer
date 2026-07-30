import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';

import {
  IFileInfo,
  IParsingResult,
  IProcessingResult,
  IYandexApiResult,
} from '../../../types/yandex-market.types';
import { QUEUE_NAMES, JOB_TYPES } from '../../index';

/**
 * @deprecated Продюсер джоб конвейера изменения цен
 * (PROCESS_FILE → PARSE_FILE → FETCH_YANDEX_DATA → COMPARE_DATA →
 * UPDATE_YANDEX_OFFERS → SEND_COMPLETION). Конвейер отключён вместе с
 * изменением цен; из нового кода не вызывать.
 *
 * Дефект конвейера, который нельзя повторить: на УСПЕШНОМ пути временный файл
 * не удаляется. FileProcessingProcessor пересобирает fileInfo с `filePath: ''`,
 * а YandexApiProcessor удаляет файл только `if (processingResult.fileInfo.filePath)` —
 * условие никогда не выполняется, и static/temp растёт после каждой удачной
 * обработки. Чистится только на ветках ошибок.
 */
export interface FileProcessingJobData {
  userId: string;
  chatId: string;
  fileInfo: {
    filename: string;
    originalName: string;
    filePath: string;
    fileSize: number;
    uploadedAt: Date;
  };
  botToken: string;
}

export interface ParseFileJobData {
  userId: string;
  chatId: string;
  fileInfo: IFileInfo;
  botToken: string;
  sessionId: string;
}

export interface CompareDataJobData {
  userId: string;
  chatId: string;
  parsingResult: IParsingResult;
  yandexApiResult: IYandexApiResult;
  botToken: string;
  sessionId: string;
}

export interface FetchYandexDataJobData {
  userId: string;
  chatId: string;
  parsingResult: IParsingResult;
  botToken: string;
  sessionId: string;
}

export interface UpdateYandexOffersJobData {
  userId: string;
  chatId: string;
  processingResult: IProcessingResult;
  botToken: string;
  sessionId: string;
}

export interface NotificationJobData {
  botToken: string;
  chatId: string;
  message: string;
  sessionId?: string;
}

export interface ProgressNotificationJobData extends NotificationJobData {
  step: string;
  details?: string;
}

export interface CompletionNotificationJobData extends NotificationJobData {
  results: any;
  priceCoefficient: number;
}

export interface ErrorNotificationJobData extends NotificationJobData {
  error: string;
}

@Injectable()
export class FileProcessingService {
  constructor(
    @InjectQueue(QUEUE_NAMES.FILE_PROCESSING)
    private readonly fileProcessingQueue: Queue<ParseFileJobData | CompareDataJobData>,
    @InjectQueue(QUEUE_NAMES.YANDEX_API)
    private readonly yandexApiQueue: Queue<FetchYandexDataJobData | UpdateYandexOffersJobData>,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS)
    private readonly notificationsQueue: Queue<NotificationJobData>,
  ) {}

  // FILE_PROCESSING очередь
  async addFileProcessingJob(data: FileProcessingJobData): Promise<void> {
    // Временно оставляем в FILE_PROCESSING очереди
    await this.fileProcessingQueue.add(JOB_TYPES.PROCESS_FILE, data as any, {
      priority: 2,
    });
  }

  async addParseFileJob(data: ParseFileJobData): Promise<void> {
    await this.fileProcessingQueue.add(JOB_TYPES.PARSE_FILE, data, {
      priority: 3,
    });
  }

  async addCompareDataJob(data: CompareDataJobData): Promise<void> {
    await this.fileProcessingQueue.add(JOB_TYPES.COMPARE_DATA, data, {
      priority: 3,
    });
  }

  // YANDEX_API очередь
  async addFetchYandexDataJob(data: FetchYandexDataJobData): Promise<void> {
    await this.yandexApiQueue.add(JOB_TYPES.FETCH_YANDEX_DATA, data, {
      priority: 3,
    });
  }

  async addUpdateYandexOffersJob(data: UpdateYandexOffersJobData): Promise<void> {
    await this.yandexApiQueue.add(JOB_TYPES.UPDATE_YANDEX_OFFERS, data, {
      priority: 3,
    });
  }

  // NOTIFICATIONS очередь
  async addProgressNotification(data: ProgressNotificationJobData): Promise<void> {
    await this.notificationsQueue.add(JOB_TYPES.SEND_PROGRESS, data, {
      priority: 5,
    });
  }

  async addCompletionNotification(data: CompletionNotificationJobData): Promise<void> {
    await this.notificationsQueue.add(JOB_TYPES.SEND_COMPLETION, data, {
      priority: 4,
    });
  }

  async addErrorNotification(data: ErrorNotificationJobData): Promise<void> {
    await this.notificationsQueue.add(JOB_TYPES.SEND_ERROR, data, {
      priority: 6, // Высший приоритет для ошибок
    });
  }

  async getQueueStatus() {
    return {
      fileProcessing: {
        active: await this.fileProcessingQueue.getActiveCount(),
        waiting: await this.fileProcessingQueue.getWaitingCount(),
        completed: await this.fileProcessingQueue.getCompletedCount(),
        failed: await this.fileProcessingQueue.getFailedCount(),
        delayed: await this.fileProcessingQueue.getDelayedCount(),
      },
      yandexApi: {
        active: await this.yandexApiQueue.getActiveCount(),
        waiting: await this.yandexApiQueue.getWaitingCount(),
        completed: await this.yandexApiQueue.getCompletedCount(),
        failed: await this.yandexApiQueue.getFailedCount(),
        delayed: await this.yandexApiQueue.getDelayedCount(),
      },
      notifications: {
        active: await this.notificationsQueue.getActiveCount(),
        waiting: await this.notificationsQueue.getWaitingCount(),
        completed: await this.notificationsQueue.getCompletedCount(),
        failed: await this.notificationsQueue.getFailedCount(),
        delayed: await this.notificationsQueue.getDelayedCount(),
      },
    };
  }

  async cleanAllQueues(): Promise<void> {
    const queues = [this.fileProcessingQueue, this.yandexApiQueue, this.notificationsQueue];

    for (const queue of queues) {
      await queue.clean(0, 'completed');
      await queue.clean(0, 'wait');
      await queue.clean(0, 'active');
      await queue.clean(0, 'delayed');
      await queue.clean(0, 'failed');
    }
  }
}
