import type { TTelegrafBot } from '../../../domain.telegram';

import { Injectable, Logger } from '@nestjs/common';
import { message } from 'telegraf/filters';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { formatStockReport } from '../../../../yandex/stocks/stock-report';
import { StockSyncService } from '../../../../yandex/stocks/stock-sync.service';
import { YandexApiError } from '../../../../yandex/yandex-api.errors';
import { htmlOptions } from '../../../formatting/telegram-format';

/**
 * Приём прайс-листа и обновление остатков.
 *
 * ЕДИНСТВЕННЫЙ путь записи в Яндекс из интерфейса бота. Всё остальное —
 * отчёты — только читает.
 */

/**
 * Ограничения загрузки. Прежний сервис их ПОТЕРЯЛ при миграции: его ужали с
 * 293 строк до 67, и вместе с кодом исчезли лимит размера, список разрешённых
 * расширений и проверка MIME. Скачивался и ставился в очередь любой присланный
 * файл — хоть двухгигабайтное видео.
 */
export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  extensions: ['.xlsx', '.xls'] as const,
  /** Слово в подписи к файлу, включающее режим проверки без записи. */
  dryRunKeyword: 'проверка',
} as const;

@Injectable()
export class StockUploadHandler {
  private readonly logger = new Logger(StockUploadHandler.name);

  /** Кто прямо сейчас грузит. Защёлка против двойной отправки одного файла. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly stocks: StockSyncService,
    private readonly yandexMarketService: YandexMarketService,
  ) {}

  public register(bot: TTelegrafBot): void {
    bot.on(message('document'), async (ctx) => {
      const lock = `${ctx.botInfo.id}:${ctx.from.id}`;

      // Защёлку ставим синхронно с проверкой, до первого await: иначе два
      // быстрых файла проскочат оба и устроят гонку записи остатков.
      if (this.inFlight.has(lock)) {
        await ctx.reply('⏳ Предыдущий файл ещё обрабатывается, подождите.');
        return;
      }
      this.inFlight.add(lock);

      try {
        await this.handleDocument(ctx);
      } catch (error) {
        await this.replyWithError(ctx, error);
      } finally {
        this.inFlight.delete(lock);
      }
    });
  }

  private async handleDocument(ctx: any): Promise<void> {
    const doc = ctx.message.document;
    const fileName: string = doc.file_name ?? '';

    // ПОРЯДОК ПРОВЕРОК ЗНАЧИМ: сначала дешёвые, потом скачивание.
    // Прежний код качал файл на диск и ставил джобу в очередь ДО любой
    // проверки — настройки проверялись уже в воркере.

    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (!UPLOAD_LIMITS.extensions.includes(ext as never)) {
      await ctx.reply(
        `⚠️ Нужен файл Excel (${UPLOAD_LIMITS.extensions.join(' или ')}). Получен «${fileName}».`,
      );
      return;
    }

    if ((doc.file_size ?? 0) > UPLOAD_LIMITS.maxBytes) {
      const mb = (UPLOAD_LIMITS.maxBytes / 1024 / 1024).toFixed(0);
      await ctx.reply(`⚠️ Файл больше ${mb} МБ. Пришлите файл меньшего размера.`);
      return;
    }

    // Креды проверяем ДО скачивания: без них загрузка бессмысленна.
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    if (!store?.campaign_id || !store?.business_id || !store?.token) {
      await ctx.reply('⚠️ Сначала заполните настройки API.', htmlOptions());
      return;
    }

    const dryRun = String(ctx.message.caption ?? '')
      .toLowerCase()
      .includes(UPLOAD_LIMITS.dryRunKeyword);

    await ctx.reply(
      dryRun
        ? '🔍 Проверяю файл, в Яндекс ничего записывать не буду…'
        : '⏳ Загружаю остатки, это займёт минуту…',
    );

    // Файл держим В ПАМЯТИ, на диск не пишем.
    //
    // Прежний конвейер сохранял его в static/temp и на успешном пути НЕ удалял:
    // fileInfo пересобиралcя с filePath:'' , из-за чего условие удаления не
    // срабатывало никогда, и каталог рос после каждой обработки. Прайс — это
    // мегабайты, буфер живёт секунды: файловая система тут не нужна вовсе,
    // а значит и утечь нечему.
    const link = await ctx.telegram.getFileLink(doc.file_id);
    const response = await fetch(link.href);
    if (!response.ok) {
      throw new Error(`не удалось скачать файл: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const result = await this.stocks.sync(
      {
        token: store.token,
        campaignId: store.campaign_id,
        businessId: store.business_id,
      },
      buffer,
      { dryRun, telegramUserId: ctx.from.id.toString() },
    );

    this.logger.log(
      `Остатки (${dryRun ? 'проверка' : 'запись'}) для ${ctx.from.id}: ` +
        `${result.updated}/${result.matched} из ${result.totalRows}, пропущено ${result.skipped.length}`,
    );

    await ctx.reply(formatStockReport(result), htmlOptions());
  }

  private async replyWithError(ctx: any, error: unknown): Promise<void> {
    this.logger.error(`Загрузка остатков не удалась для ${ctx.from?.id}`, error as Error);

    const text =
      error instanceof YandexApiError
        ? error.userMessage
        : 'Не удалось обработать файл. Проверьте, что это прайс в обычном формате, и попробуйте ещё раз.';

    await ctx.reply(`❌ ${text}`);
  }
}
