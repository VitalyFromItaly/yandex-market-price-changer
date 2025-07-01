import { Context } from 'telegraf';
import {
  IProcessingResult,
  IFileInfo,
  IParsingResult,
  IYandexApiResult,
  IComparisonResult,
  FileDataProcessorService
} from './file-data-processor.service';
import { TParsedPriceRow } from '../modules/parser/domain.parser';

export class FileResultPresenterService {

  /**
   * Показать результаты парсинга файла
   */
  static async showParsingResults(ctx: Context, fileInfo: IFileInfo, parsing: IParsingResult): Promise<void> {
    const uploadTime = new Date().toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    await ctx.reply(
      `✅ Файл успешно загружен!\n\n` +
      `🔄 Начинаю автоматическую обработку файла...`
    );
  }

  /**
   * Показать результаты парсинга
   */
  static async showParsingStepResults(ctx: Context, parsing: IParsingResult): Promise<void> {
    if (!parsing.success) {
      await ctx.reply(
        `❌ Ошибка при парсинге файла:\n\n` +
        `${parsing.error}\n\n` +
        `💡 Проверьте формат файла и попробуйте снова.`
      );
      return;
    }

    await ctx.reply(
      `✅ Парсинг завершен!\n\n` +
      `📦 Обработано товаров: ${parsing.totalItems}\n` +
      `🔢 Уникальных SKU: ${parsing.uniqueSkus.length}\n\n` +
      `🔍 Примеры SKU:\n${parsing.uniqueSkus.slice(0, 5).map(sku => `• ${sku}`).join('\n')}` +
      (parsing.uniqueSkus.length > 5 ? `\n... и еще ${parsing.uniqueSkus.length - 5}` : '')
    );
  }

  /**
   * Показать результаты получения данных из Yandex API
   */
  static async showYandexApiResults(ctx: Context, yandexApi: IYandexApiResult, totalSkus: number): Promise<void> {
    if (!yandexApi.success) {
      await ctx.reply(
        `❌ Ошибка при запросе к Yandex Market API:\n\n` +
        `${yandexApi.error}\n\n` +
        `💡 Проверьте настройки API и попробуйте снова.`
      );
      return;
    }

    await ctx.reply(
      `✅ Данные из Yandex Market получены!\n\n` +
      `📊 Обработано батчей: ${yandexApi.processedBatches}\n` +
      `🛒 Найдено товаров: ${yandexApi.offers.length} из ${totalSkus} запрошенных\n` +
      `📈 Процент покрытия: ${((yandexApi.offers.length / totalSkus) * 100).toFixed(1)}%`
    );
  }

  /**
   * Показать результаты сравнения данных
   */
  static async showComparisonResults(ctx: Context, comparison: IComparisonResult, fileInfo: IFileInfo): Promise<void> {
    const matchPercentage = FileDataProcessorService.formatPercentage(comparison.matchPercentage);

    let resultsMessage =
      `🎉 **Сравнение завершено!**\n\n` +
      `📄 Файл: ${fileInfo.originalName}\n\n` +
      `📊 **Статистика:**\n` +
      `• Совпадений: ${comparison.matched} (${matchPercentage}%)\n` +
      `• ✅ Цены совпадают: ${comparison.priceMatches}\n` +
      `• ⚠️ Цены отличаются: ${comparison.priceMismatches}\n` +
      `• 📦 Только в файле: ${comparison.onlyInParser}\n` +
      `• 🛒 Только в Yandex: ${comparison.onlyInYandex}`;
    
    if (comparison.toZeroStock && comparison.toZeroStock.length > 0) {
      resultsMessage += `\n• 🔴 Для обнуления остатков: ${comparison.toZeroStock.length}`;
    }

    await ctx.reply(resultsMessage);
  }

  /**
   * Показать сообщение об отсутствии настроек API
   */
  static async showMissingApiSettings(ctx: Context): Promise<void> {
    await ctx.reply(
      `❌ Настройки Yandex Market API не найдены или не полные!\n\n` +
      `🔧 Для продолжения необходимо настроить API:\n` +
      `• Campaign ID\n` +
      `• Business ID\n` +
      `• API Token\n\n` +
      `💡 Используйте команду /settings для настройки API.`
    );
  }

  /**
   * Показать результаты парсинга без сравнения с API
   */
  static async showParsingOnlyResults(ctx: Context, fileInfo: IFileInfo, parsing: IParsingResult): Promise<void> {
    await ctx.reply(
      `📊 **Парсинг завершен**\n\n` +
      `📄 Файл: ${fileInfo.originalName}\n` +
      `📦 Товаров: ${parsing.totalItems}\n` +
      `🔢 Уникальных SKU: ${parsing.uniqueSkus.length}\n\n` +
      `⚠️ **Для сравнения с Yandex Market настройте API:**\n` +
      `• Campaign ID\n` +
      `• Business ID\n` +
      `• API Token\n\n` +
      `💡 Используйте команду /settings`
    );
  }

  /**
   * Показать клавиатуру с действиями для файла
   */
  static async showFileActionsKeyboard(ctx: Context, fileInfo: IFileInfo, parsing?: IParsingResult): Promise<void> {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📊 Обработать файл', callback_data: `process_file:${fileInfo.filename}` },
          { text: '👁️ Просмотр содержимого', callback_data: `preview_file:${fileInfo.filename}` }
        ],
        [
          { text: '🗑️ Удалить файл', callback_data: `delete_file:${fileInfo.filename}` },
          { text: '📋 Все файлы', callback_data: 'list_files' }
        ]
      ]
    };

    let message = `🎯 Выберите действие с файлом "${fileInfo.originalName}":`;

    if (parsing) {
      message += `\n\n📦 В файле найдено ${parsing.totalItems} товаров`;
    }

    await ctx.reply(message, { reply_markup: keyboard });
  }

  /**
   * Показать прогресс обработки
   */
  static async showProgressMessage(ctx: Context, step: string, details?: string): Promise<void> {
    let message = `🔄 ${step}`;
    if (details) {
      message += `\n\n${details}`;
    }
    await ctx.reply(message);
  }

  /**
   * Показать прогресс обработки батчей
   */
  static async showBatchProgress(ctx: Context, currentBatch: number, totalBatches: number, batchSize: number): Promise<void> {
    await ctx.reply(`📊 Обрабатываю батч ${currentBatch}/${totalBatches} (${batchSize} SKU)`);
  }

  /**
   * Показать полные результаты обработки - компактная версия
   */
  static async showCompleteResults(ctx: Context, result: IProcessingResult): Promise<void> {
    if (!result.hasApiSettings) {
      // Только парсинг без API
      await this.showParsingOnlyResults(ctx, result.fileInfo, result.parsing);
      return;
    }

    if (result.comparison) {
      // Показываем финальные результаты со сравнением
      await this.showFinalResults(ctx, result);
    } else if (result.yandexApi && !result.yandexApi.success) {
      // Ошибка API - показываем только парсинг
      await this.showParsingOnlyResults(ctx, result.fileInfo, result.parsing);
    }
  }

  /**
   * Показать финальные результаты с полной статистикой
   */
  private static async showFinalResults(ctx: Context, result: IProcessingResult): Promise<void> {
    const { fileInfo, parsing, yandexApi, comparison } = result;

    if (!comparison || !yandexApi) {
      return;
    }

    const matchPercentage = FileDataProcessorService.formatPercentage(comparison.matchPercentage);

    let message =
      `🎉 **Обработка завершена!**\n\n` +
      `📄 **Файл:** ${fileInfo.originalName}\n` +
      `📦 **Товаров в файле:** ${parsing.totalItems}\n` +
      `🔢 **Уникальных SKU:** ${parsing.uniqueSkus.length}\n` +
      `🛒 **Найдено в Yandex:** ${yandexApi.offers.length}\n` +
      `✅ **Совпадений:** ${comparison.matched} (${matchPercentage}%)\n\n` +
      `🔄 **Планируемые действия:**\n` +
      `• 🔄 Обновить: ${comparison.toUpdate.length} товаров\n` +
      `• ➕ Создать: ${comparison.toCreate.length} товаров\n`;
    
    if (comparison.toZeroStock.length > 0) {
      message += `• 🔴 Обнулить остатки: ${comparison.toZeroStock.length} товаров\n`;
    }
    
    message +=
      `\n💰 **Анализ цен:**\n` +
      `• Совпадают: ${comparison.priceMatches}\n` +
      `• Отличаются: ${comparison.priceMismatches}\n`;
    
    if (comparison.toZeroStock.length > 0) {
      message += `\n🔍 **Автоматическое обнуление:** Товары, отсутствующие в файле, получат нулевые остатки.`;
    }

    await ctx.reply(message);
  }
}
