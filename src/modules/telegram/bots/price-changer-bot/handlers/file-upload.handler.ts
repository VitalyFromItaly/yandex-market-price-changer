import { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { FileUploadService, IFileInfo } from '../../../services/file-upload.service';
import { FileProcessingService } from '../../../queue/services/file-processing.service';
import { ITelegramKeyboard } from '../../../domain.telegram';
import { Document } from 'telegraf/types';

interface FileMessage {
  document?: Document & { file_name?: string; file_size?: number; file_id?: string };
}

/**
 * @deprecated Приём документа для отключённого изменения цен. Регистрация
 * `bot.on(message('document'))` снята (TASK-009), поэтому класс сейчас мёртв.
 * Загрузка файла вернётся только под остатки (TASK-035) и будет написана заново.
 *
 * Дефект, который нельзя повторить: handleDocument скачивает файл и ставит
 * джобу в очередь ДО проверки подписки и готовности кредов — проверка
 * isConfigured выполняется уже в воркере, то есть после записи файла на диск.
 */
export class FileUploadHandler {
  private readonly uploadService: FileUploadService;

  constructor(
    private readonly bot: Telegraf,
    private readonly botToken: string,
    private readonly fileProcessingService: FileProcessingService,
  ) {
    this.uploadService = new FileUploadService();
  }

  public init(): void {
    this.bot.on(message('document'), this.handleDocument.bind(this));
  }

  private async handleDocument(ctx: Context & { message: FileMessage }): Promise<void> {
    const file = ctx.message.document;
    if (!file || !file.file_id) {
      await ctx.reply('Не удалось получить файл. Пожалуйста, попробуйте еще раз.');
      return;
    }

    const fileLink = await this.bot.telegram.getFileLink(file.file_id);

    try {
      const fileInfo = await this.uploadService.saveFile(
        fileLink.href,
        file.file_name || 'price-list',
        '', // mimeType не используется в saveFile
        file.file_size || 0,
      );

      await ctx.reply(
        `📄 Файл "${fileInfo.originalName}" получен и добавлен в очередь на обработку. Вы получите уведомление, когда все будет готово.`,
      );

      await this.fileProcessingService.addFileProcessingJob({
        userId: String(ctx.from?.id),
        chatId: String(ctx.chat?.id),
        fileInfo,
        botToken: this.botToken,
      });
    } catch (error) {
      console.error('Error handling document:', error);
      await ctx.reply('Произошла ошибка при обработке вашего файла. Пожалуйста, попробуйте еще раз.');
    }
  }
}
