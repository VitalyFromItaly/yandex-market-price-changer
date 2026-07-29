import { Process, Processor } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Job } from 'bull';

import { esc } from '../../formatting/telegram-format';
import { QUEUE_NAMES, JOB_TYPES } from '../../index';
import TelegramApiService from '../../services/telegram.api.service';
import {
  ProgressNotificationJobData,
  CompletionNotificationJobData,
  ErrorNotificationJobData,
} from '../services/file-processing.service';

@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationsProcessor {
  constructor() {}

  @Process({ name: JOB_TYPES.SEND_PROGRESS, concurrency: 1 })
  async handleProgressNotification(job: Job<ProgressNotificationJobData>) {
    const { botToken, chatId, step, details } = job.data;

    try {
      // step и details приходят из полезной нагрузки джобы и могут содержать
      // данные Маркета — экранируем, иначе символ < сломает разметку.
      let message = `🔄 ${esc(step)}`;
      if (details) {
        message += `\n\n${esc(details)}`;
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
      // Текст ошибки приходит из внешнего источника — обязательно экранируем.
      const message = `❌ Произошла ошибка при обработке файла:\n\n${esc(error)}\n\n💡 Попробуйте загрузить файл ещё раз.`;
      await TelegramApiService.sendMessage(botToken, chatId, message);
      return { success: true };
    } catch (sendError) {
      console.error('Error sending error notification:', sendError);
      throw sendError;
    }
  }

  /**
   * @deprecated Отчёт об изменении цен — функционал отключён (TASK-009).
   * Отчёты по заказам (M5) форматируются отдельно.
   *
   * Дефект на память: 'без изменений' здесь определялось как priceCoefficient === 2,
   * хотя «без изменений» — это коэффициент 1.0. Двойка была fallback-значением,
   * то есть отчёт называл «без изменений» реальное УДВОЕНИЕ цены.
   */
  private formatPriceUpdateReport(results: any, priceCoefficient: number): string {
    const { updated, created, zeroed, errors, summary } = results;
    const coefficientText =
      priceCoefficient === 2
        ? 'без изменений'
        : `x${priceCoefficient} (${priceCoefficient > 1 ? '+' : ''}${((priceCoefficient - 1) * 100).toFixed(1)}%)`;

    let message = `✅ <b>Обработка завершена!</b>\n\n`;
    message += `💰 <b>Коэффициент:</b> ${coefficientText}\n\n`;
    message += `📊 <b>Результаты:</b>\n`;
    message += `• 🔄 Обновлено товаров: <b>${updated}</b>\n`;
    message += `• ➕ Создано товаров: <b>${created}</b>\n`;

    if (zeroed > 0) {
      message += `• 🔴 Обнулено остатков: <b>${zeroed}</b>\n`;
    }

    message += `• 📋 Всего обработано: <b>${summary.totalProcessed}</b>\n`;

    if (errors.length > 0) {
      message += `• ❌ Ошибок: <b>${errors.length}</b>\n`;
    }

    const successRate =
      summary.totalProcessed > 0
        ? Math.round(
            ((summary.successfulUpdates + summary.successfulCreations + summary.successfulZeroing) /
              summary.totalProcessed) *
              100,
          )
        : 0;

    message += `\n📈 <b>Успешность:</b> ${successRate}%\n`;

    if (errors.length > 0) {
      message += `\n⚠️ <b>Первые ошибки:</b>\n`;
      const firstErrors = errors.slice(0, 3);
      firstErrors.forEach((error, index) => {
        if (error.type === 'creation_error') {
          message += `${index + 1}. Товар ${esc(error.offerId)}: ${esc(error.errors[0]?.message || 'Неизвестная ошибка')}\n`;
        } else {
          message += `${index + 1}. ${esc(error.error)}\n`;
        }
      });

      if (errors.length > 3) {
        message += `... и ещё ${errors.length - 3} ошибок\n`;
      }
    }

    if (zeroed > 0) {
      message += `\n🔍 <b>Обнуление остатков:</b> Товары, которые есть в Yandex, но отсутствуют в файле, автоматически получили нулевые остатки.\n`;
    }

    message += `\n💡 Все изменения будут видны в личном кабинете Yandex Market через несколько минут.`;

    return message;
  }
}
