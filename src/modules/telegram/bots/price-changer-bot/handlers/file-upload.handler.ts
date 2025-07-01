import { Context } from 'telegraf';
import { Document } from 'telegraf/types';
import {
  FileUploadService,
  IFileUploadResult,
} from '../../../../../services/file-upload.service';
import { TTelegrafBot } from '../../../domain.telegram';
import {
  FileDataProcessorService,
  IFileInfo,
  IParsingResult,
  IProcessingResult,
} from '../../../../../services/file-data-processor.service';
import { FileResultPresenterService } from '../../../../../services/file-result-presenter.service';
import { YandexMarketModel } from '../../../../../database/mongo';
import { PriceChanger } from '../../../../yandex/handlers/price.changer.handler';

interface FileMessage {
  document?: Document;
}

export class FileUploadHandler {
  private bot: TTelegrafBot;
  private readonly botToken: string;

  constructor(bot: TTelegrafBot, botToken: string) {
    this.bot = bot;
    this.botToken = botToken;
  }

  /**
   * Инициализация обработчиков файлов
   */
  init(): void {
    // Обработчик документов (Excel, CSV файлы)
    this.bot.on('document', this.handleDocument.bind(this));

    // Команда для просмотра загруженных файлов
    this.bot.command('files', this.handleFilesCommand.bind(this));

    // Команда для очистки временных файлов
    this.bot.command('cleanup', this.handleCleanupCommand.bind(this));
  }

  /**
   * Обработка загруженного документа
   */
  private async handleDocument(ctx: Context): Promise<void> {
    try {
      const message = ctx.message as FileMessage;
      const document = message?.document;

      if (!document) {
        await ctx.reply('❌ Не удалось получить информацию о файле');
        return;
      }

      const userId = ctx.from?.id?.toString();
      if (!userId) {
        await ctx.reply('❌ Не удалось определить пользователя');
        return;
      }

      // Показываем индикатор загрузки
      await ctx.replyWithChatAction('upload_document');

      // Проверяем расширение файла
      const fileName = document.file_name || 'unknown';
      const fileExtension = this.getFileExtension(fileName);

      if (!this.isAllowedFileType(fileExtension)) {
        await ctx.reply(
          `❌ Неподдерживаемый тип файла: ${fileExtension}\n\n` +
            `📋 Поддерживаемые форматы:\n` +
            `• Excel (.xlsx, .xls)\n` +
            `• CSV (.csv)\n\n` +
            `💡 Пожалуйста, загрузите файл в одном из поддерживаемых форматов.`,
        );
        return;
      }

      // Проверяем размер файла
      const fileSize = document.file_size || 0;
      if (fileSize > 10 * 1024 * 1024) {
        // 10MB
        await ctx.reply(
          `❌ Файл слишком большой: ${(fileSize / 1024 / 1024).toFixed(2)}MB\n\n` +
            `📏 Максимальный размер файла: 10MB\n\n` +
            `💡 Пожалуйста, уменьшите размер файла или разбейте его на части.`,
        );
        return;
      }

      await ctx.reply(
        `📥 Начинаю загрузку файла...\n\n` +
          `📄 Имя файла: ${fileName}\n` +
          `📊 Размер: ${(fileSize / 1024).toFixed(2)} KB\n` +
          `🔄 Это может занять некоторое время...`,
      );

      // Загружаем файл
      const result: IFileUploadResult =
        await FileUploadService.downloadTelegramFile(
          this.botToken,
          document.file_id,
          userId,
          fileName,
        );

      if (result.success && result.file) {
        const processingResult = await this.handleSuccessfulUpload(
          ctx,
          result.file,
        );
        await this.handlePriceChangeResult(ctx, processingResult);
        return;
      }
      
      await ctx.reply(
        `❌ Ошибка при загрузке файла:\n${result.error}\n\n` +
          `💡 Попробуйте загрузить файл ещё раз или обратитесь к администратору.`,
      );
    } catch (error) {
      console.error('❌ Error handling document:', error);
      await ctx.reply(
        `❌ Произошла ошибка при обработке файла.\n\n` +
          `💡 Попробуйте загрузить файл ещё раз.`,
      );
    }
  }

  private async handlePriceChangeResult(
    ctx: Context,
    processingResult: IProcessingResult | null,
  ): Promise<void> {
    if (!processingResult) {
      await ctx.reply(
        '❌ Ошибка при обработке файла. Попробуйте загрузить файл ещё раз.',
      );
      return;
    }

    const yandexMarketModel = await YandexMarketModel.findOne({
      telegramUserId: ctx.from?.id?.toString(),
    });

    if (!yandexMarketModel) {
      await ctx.reply(
        '❌ Настройки Yandex Market не найдены. Пожалуйста, настройте API в профиле.',
      );
      return;
    }

    console.log({ yandexMarketModel });

    if (!yandexMarketModel?.isConfigured()) {
      await ctx.reply(
        '❌ Настройки Yandex Market не заполнены. Пожалуйста, настройте API в профиле.',
      );
      return;
    }

    // Получаем путь к файлу для последующего удаления
    const uploadedFilePath = processingResult.fileInfo?.filePath;

    try {
      await ctx.reply('🔄 Начинаю обновление цен в Yandex Market...');

      const priceChanger = new PriceChanger(
        yandexMarketModel.token,
        Number(yandexMarketModel.campaign_id),
        Number(yandexMarketModel.business_id),
      );

      const results = await priceChanger.updateOrCreateOffers(processingResult);
      
      // Формируем отчет о результатах
      const reportMessage = this.formatPriceUpdateReport(results, yandexMarketModel.priceCoefficient || 1.8);
      await ctx.reply(reportMessage);

      // ✅ Удаляем обработанный файл после успешного завершения
      if (uploadedFilePath) {
        const deleted = await FileUploadService.deleteFile(uploadedFilePath);
        if (deleted) {
          console.log(`🗑️ Successfully deleted processed file: ${uploadedFilePath}`);
        } else {
          console.warn(`⚠️ Failed to delete file: ${uploadedFilePath}`);
        }
      }

    } catch (error) {
      console.error('❌ Error updating prices:', error);
      await ctx.reply(
        '❌ Произошла ошибка при обновлении цен в Yandex Market.\n\n' +
        `Ошибка: ${error.message || error}\n\n` +
        '💡 Проверьте настройки API и попробуйте ещё раз.'
      );

      // ⚠️ Удаляем файл даже при ошибке обработки
      if (uploadedFilePath) {
        const deleted = await FileUploadService.deleteFile(uploadedFilePath);
        if (deleted) {
          console.log(`🗑️ Deleted file after error: ${uploadedFilePath}`);
        }
      }
    }
  }

  /**
   * Форматирование отчета о результатах обновления цен
   */
  private formatPriceUpdateReport(results: any, priceCoefficient: number): string {
    const { updated, created, zeroed, errors, summary } = results;

    const coefficientText = priceCoefficient === 1.8
      ? 'без изменений'
      : `x${priceCoefficient} (${priceCoefficient > 1 ? '+' : ''}${((priceCoefficient - 1) * 100).toFixed(1)}%)`;

    let message = `✅ **Обновление завершено!**\n\n`;
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

  /**
   * Обработка успешной загрузки файла
   */
  private async handleSuccessfulUpload(
    ctx: Context,
    file: any,
  ): Promise<IProcessingResult | null> {
    const fileInfo: IFileInfo = {
      filename: file.filename,
      originalName: file.originalName,
      filePath: file.filePath,
      fileSize: file.fileSize,
      uploadedAt: new Date(),
    };

    // Показываем сообщение о загрузке
    await ctx.reply(
      `✅ Файл загружен: ${fileInfo.originalName}\n` +
        `📊 Размер: ${(fileInfo.fileSize / 1024).toFixed(2)} KB\n\n` +
        `🔄 Начинаю обработку...`,
    );

    // Автоматически обрабатываем файл
    return await this.processUploadedFile(ctx, fileInfo);
  }

  /**
   * Обработка загруженного файла с парсингом и сравнением с Yandex API
   */
  private async processUploadedFile(
    ctx: Context,
    fileInfo: IFileInfo,
  ): Promise<IProcessingResult | null> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        await ctx.reply('❌ Не удалось определить пользователя');
        // Удаляем файл при ошибке определения пользователя
        await FileUploadService.deleteFile(fileInfo.filePath);
        return null;
      }

      // Создаем коллбек для отображения прогресса
      const progressCallback = async (step: string, details?: string) => {
        await FileResultPresenterService.showProgressMessage(
          ctx,
          step,
          details,
        );
      };

      // Основная обработка через FileDataProcessorService с коллбеком прогресса
      const result = await FileDataProcessorService.processFile(
        fileInfo,
        userId,
        progressCallback,
      );

      // Показываем полные результаты
      await FileResultPresenterService.showCompleteResults(ctx, result);
      return result;
    } catch (error) {
      console.error('❌ Error processing uploaded file:', error);
      await ctx.reply(
        `❌ Ошибка при обработке файла:\n\n` +
          `${error}\n\n` +
          `💡 Попробуйте загрузить файл ещё раз.`,
      );

      // ⚠️ Удаляем файл при ошибке парсинга
      const deleted = await FileUploadService.deleteFile(fileInfo.filePath);
      if (deleted) {
        console.log(`🗑️ Deleted file after processing error: ${fileInfo.filePath}`);
      }

      return null;
    }
  }

  /**
   * Команда для просмотра всех файлов
   */
  private async handleFilesCommand(ctx: Context): Promise<void> {
    try {
      await ctx.replyWithChatAction('typing');

      const files = await FileUploadService.getTempFiles();

      if (files.length === 0) {
        await ctx.reply(
          `📂 Нет загруженных файлов\n\n` +
            `💡 Загрузите Excel или CSV файл для начала работы.`,
        );
        return;
      }

      let message = `📋 Загруженные файлы (${files.length}):\n\n`;

      files.forEach((file, index) => {
        const uploadTime = file.uploadedAt.toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });

        message += `${index + 1}. 📄 ${file.originalName}\n`;
        message += `   💾 ${file.filename}\n`;
        message += `   📊 ${(file.fileSize / 1024).toFixed(2)} KB\n`;
        message += `   🕐 ${uploadTime}\n\n`;
      });

      message += `💡 Используйте команду /cleanup для очистки старых файлов.`;

      await ctx.reply(message);
    } catch (error) {
      console.error('❌ Error handling files command:', error);
      await ctx.reply('❌ Ошибка при получении списка файлов');
    }
  }

  /**
   * Команда для очистки временных файлов
   */
  private async handleCleanupCommand(ctx: Context): Promise<void> {
    try {
      await ctx.replyWithChatAction('typing');

      const deletedCount = await FileUploadService.cleanupOldFiles(24); // Удаляем файлы старше 24 часов

      if (deletedCount > 0) {
        await ctx.reply(
          `🧹 Очистка завершена!\n\n` +
            `🗑️ Удалено файлов: ${deletedCount}\n` +
            `💡 Удалены файлы старше 24 часов.`,
        );
      } else {
        await ctx.reply(
          `✨ Все файлы актуальны!\n\n` +
            `📂 Нет файлов для удаления.\n` +
            `💡 Файлы автоматически удаляются через 24 часа.`,
        );
      }
    } catch (error) {
      console.error('❌ Error handling cleanup command:', error);
      await ctx.reply('❌ Ошибка при очистке файлов');
    }
  }

  /**
   * Получение расширения файла
   */
  private getFileExtension(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex !== -1
      ? fileName.substring(lastDotIndex).toLowerCase()
      : '';
  }

  /**
   * Проверка допустимого типа файла
   */
  private isAllowedFileType(extension: string): boolean {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    return allowedExtensions.includes(extension);
  }

  /**
   * Форматирование размера файла
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
