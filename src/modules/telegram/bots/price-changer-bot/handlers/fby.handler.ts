import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { FbyService } from '../../../../../modules/yandex/fby/fby.service';
import { YandexApiError } from '../../../../../modules/yandex/yandex-api.errors';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import { htmlOptions } from '../../../formatting/telegram-format';
import { StorePromptService } from '../../shared/services/store-prompt.service';

/**
 * Сводка FBY одним экраном: остатки по типам, проблемные позиции, заявки на
 * вывоз/утилизацию, «едет до клиента»/«едет обратно».
 *
 * Зовётся из кнопки меню «📦 FBY» через MenuCommandsHandler — как обзор складов
 * через WarehousesHandler, поэтому в пайплайн composer'а отдельным шагом не
 * встаёт. Доступ закрыт фичей `fby` (по умолчанию выключена): гейт возможностей
 * отбивает кнопку раньше этого хендлера, свободного текста у сводки нет —
 * перепроверять флаг здесь не нужно.
 *
 * Запрос к Partner API — только чтение. Экран небыстрый: остатки FBY приходят
 * из асинхронного отчёта (~10–20 c), поэтому есть и «⏳ Собираю…», и защёлка от
 * повторного запуска. Проблемные позиции сверх порога уходят ОТДЕЛЬНЫМ
 * документом (а не подписью к файлу) — обходим лимит подписи Telegram в 1024.
 */
@Injectable()
export class FbyHandler {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly fby: FbyService,
    private readonly stores: YandexMarketService,
    private readonly errors: ErrorReporter,
    private readonly storePrompt: StorePromptService,
  ) {}

  public async handle(ctx: Context): Promise<void> {
    const lock = `${ctx.botInfo.id}:${ctx.from.id}`;
    if (this.inFlight.has(lock)) {
      await ctx.reply('⏳ Сводка FBY уже собирается, подождите немного.');
      return;
    }
    this.inFlight.add(lock);

    try {
      const store = await this.stores.findByTelegramUser(ctx.from.id.toString());
      if (!store) {
        await this.storePrompt.replyNeedsStore(ctx);
        return;
      }

      await ctx.reply('⏳ Собираю сводку FBY, это займёт до минуты…');

      const result = await this.fby.build(store);
      await ctx.reply(result.text, htmlOptions());

      if (result.problemExport) {
        await ctx.replyWithDocument({
          source: result.problemExport.buffer,
          filename: result.problemExport.filename,
        });
      }
    } catch (error) {
      await this.replyWithError(ctx, error);
    } finally {
      this.inFlight.delete(lock);
    }
  }

  private async replyWithError(ctx: Context, error: unknown): Promise<void> {
    void this.errors.report({
      error,
      source: 'bot',
      context: 'fby',
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action: 'сводка FBY',
    });

    const message =
      error instanceof YandexApiError
        ? error.userMessage
        : 'Не удалось собрать сводку FBY. Попробуйте позже.';

    await ctx.reply(`❌ ${message}`, htmlOptions());
  }
}
