import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import {
  ProgressNotificationJobData,
  CompletionNotificationJobData,
  ErrorNotificationJobData,
} from '../services/file-processing.service';
import TelegramApiService from '../../services/telegram.api.service';
import { QUEUE_NAMES, JOB_TYPES } from '../../index';

@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationsProcessor {
  constructor() {}

  @Process({ name: JOB_TYPES.SEND_PROGRESS, concurrency: 1 })
  async handleProgressNotification(job: Job<ProgressNotificationJobData>) {
    const { botToken, chatId, step, details } = job.data;

    try {
      let message = `🔄 ${step}`;
      if (details) {
        message += `\n\n${details}`;
      }

      await TelegramApiService.sendMessage(botToken, chatId, message);
      return { success: true };
    } catch (error) {
      console.error('Error sending progress notification:', error);
      throw error;
    }
  }

  @Process({ name: JOB_TYPES.SEND_COMPLETION, concurrency: 3 })
  async handleCompletionNotification(job: Job<CompletionNotificationJobData>) {
    const { botToken, chatId, results, priceCoefficient } = job.data;

    try {
      const message = this.formatPriceUpdateReport(results, priceCoefficient);
      await TelegramApiService.sendMessage(botToken, chatId, message);
      return { success: true };
    } catch (error) {
      console.error('Error sending completion notification:', error);
      throw error;
    }
  }

  @Process({ name: JOB_TYPES.SEND_ERROR, concurrency: 3 })
  async handleErrorNotification(job: Job<ErrorNotificationJobData>) {
    const { botToken, chatId, error } = job.data;

    try {
      const message = `❌ Произошла ошибка при обработке файла:\n\n${error}\n\n💡 Попробуйте загрузить файл ещё раз.`;
      await TelegramApiService.sendMessage(botToken, chatId, message);
      return { success: true };
    } catch (sendError) {
      console.error('Error sending error notification:', sendError);
      throw sendError;
    }
  }

  private formatPriceUpdateReport(results: any, priceCoefficient: number): string {
    const { updated, created, zeroed, errors, summary } = results;
    const coefficientText = priceCoefficient === 2 ? 'без изменений' : `x${priceCoefficient} (${priceCoefficient > 1 ? '+' : ''}${((priceCoefficient - 1) * 100).toFixed(1)}%)`;

    let message = `✅ **Обработка завершена!**\n\n`;
    message += `💰 **Коэффициент:** ${coefficientText}\n\n`;
    message += `📊 **Результаты:**\n`;
    message += `• 🔄 Обновлено товаров: **${updated}**\n`;
    message += `• ➕ Создано товаров: **${created}**\n`;

    if (zeroed > 0) {
      message += `• 🔴 Обнулено остатков: **${zeroed}**\n`;
    }

    message += `• 📋 Всего обработано: **${summary.totalProcessed}**\n`;

    if (errors.length > 0) {
      message += `• ❌ Ошибок: **${errors.length}**\n`;
    }

    const successRate = summary.totalProcessed > 0
      ? Math.round(((summary.successfulUpdates + summary.successfulCreations + summary.successfulZeroing) / summary.totalProcessed) * 100)
      : 0;

    message += `\n📈 **Успешность:** ${successRate}%\n`;

    if (errors.length > 0) {
      message += `\n⚠️ **Первые ошибки:**\n`;
      const firstErrors = errors.slice(0, 3);
      firstErrors.forEach((error, index) => {
        if (error.type === 'creation_error') {
          message += `${index + 1}. Товар ${error.offerId}: ${error.errors[0]?.message || 'Неизвестная ошибка'}\n`;
        } else {
          message += `${index + 1}. ${error.error}\n`;
        }
      });

      if (errors.length > 3) {
        message += `... и ещё ${errors.length - 3} ошибок\n`;
      }
    }

    if (zeroed > 0) {
      message += `\n🔍 **Обнуление остатков:** Товары, которые есть в Yandex, но отсутствуют в файле, автоматически получили нулевые остатки.\n`;
    }

    message += `\n💡 Все изменения будут видны в личном кабинете Yandex Market через несколько минут.`;

    return message;
  }
}
