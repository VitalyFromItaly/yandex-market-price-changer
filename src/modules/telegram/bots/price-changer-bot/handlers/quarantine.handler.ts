import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';

import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import {
  quarantineConfirmedText,
  quarantineEmptyText,
  quarantineErrorText,
  quarantineKeyboardRows,
  quarantineStaleText,
  quarantineText,
} from '../../../../yandex/quarantine/quarantine-message';
import { PQ_CB_PATTERN, parsePqCallback } from '../../../../yandex/quarantine/quarantine.domain';
import { YandexClientFactory } from '../../../../yandex/yandex-client.factory';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { StorePromptService } from '../../shared/services/store-prompt.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

/**
 * Экран «🚧 Карантин цен»: товары, скрытые Маркетом с витрины из-за
 * подозрительной цены, с кнопками подтверждения.
 *
 * Быстрый экран (1–2 страницы одного POST), в очередь не уезжает — класс
 * отчётов с in-memory защёлкой, не generate→poll.
 *
 * Артикул не лезет в callback_data (до 255 символов против 64 байт), поэтому
 * при отрисовке список сохраняется в `UserAccess.quarantineOfferIds`, а кнопка
 * несёт индекс. Протухший список (магазин сменили, карантин обновили) отвечает
 * «откройте заново», а не подтверждает не то.
 *
 * Подтверждение — ЗАПИСЬ в Partner API (postWrite), вторая мутирующая
 * операция приложения после остатков.
 */
@Injectable()
export class QuarantineHandler {
  constructor(
    private readonly stores: YandexMarketService,
    private readonly access: UserAccessService,
    private readonly clients: YandexClientFactory,
    private readonly keyboard: PriceChangerKeyboard,
    private readonly storePrompt: StorePromptService,
    private readonly errors: ErrorReporter,
  ) {}

  /** Кнопка меню: показать карантин. */
  public async handle(ctx: Context): Promise<void> {
    try {
      await this.renderScreen(ctx);
    } catch (error) {
      await this.replyWithError(ctx, error, 'карантин цен');
    }
  }

  /**
   * Кнопки подтверждения. Регистрируются ДО общего callback_query —
   * см. композер.
   */
  public registerCallbacks(bot: TTelegrafBot): void {
    bot.action(PQ_CB_PATTERN, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string }).data;
      const parsed = parsePqCallback(data);
      await ctx.answerCbQuery();
      if (!parsed) return;

      try {
        await this.confirm(ctx, parsed);
      } catch (error) {
        await this.replyWithError(ctx, error, 'подтверждение цены');
      }
    });
  }

  private async confirm(
    ctx: Context,
    parsed: { action: 'ok'; index: number } | { action: 'all' },
  ): Promise<void> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const account = await this.access.findByUserAndBot(telegramUserId, botId);
    const saved = account?.quarantineOfferIds ?? [];

    let offerIds: string[] = [];
    if (parsed.action === 'all') {
      offerIds = saved;
    } else if (saved[parsed.index]) {
      offerIds = [saved[parsed.index]];
    }

    if (!offerIds.length) {
      await ctx.reply(quarantineStaleText());
      return;
    }

    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store) {
      await this.storePrompt.replyNeedsStore(ctx);
      return;
    }

    await this.clients.forStore(store).confirmQuarantinePrices(offerIds);
    await ctx.reply(quarantineConfirmedText(offerIds.length));

    // Экран перерисовывается с живым списком: подтверждённые товары Маркет
    // из карантина убирает, и старые кнопки-индексы больше не действительны.
    await this.renderScreen(ctx);
  }

  /** Показ экрана + сохранение списка артикулов для кнопок-индексов. */
  private async renderScreen(ctx: Context): Promise<void> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store) {
      await this.storePrompt.replyNeedsStore(ctx);
      return;
    }

    const offers = await this.clients.forStore(store).getQuarantineOffers();

    if (!offers.length) {
      await this.access.setQuarantineOffers(telegramUserId, botId, null);
      await ctx.reply(quarantineEmptyText());
      return;
    }

    // Список пишется ДО отправки кнопок: наоборот была бы щель, в которой
    // нажатие пришло бы раньше записи и ответило «список устарел».
    await this.access.setQuarantineOffers(
      telegramUserId,
      botId,
      offers.map((offer) => offer.offerId),
    );

    const keyboard = await this.keyboard.createInlineKeyboardMatrix(quarantineKeyboardRows(offers));
    await ctx.reply(quarantineText(offers), htmlOptions({ reply_markup: keyboard.reply_markup }));
  }

  private async replyWithError(ctx: Context, error: unknown, action: string): Promise<void> {
    void this.errors.report({
      error,
      source: 'bot',
      context: 'quarantine',
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action,
    });

    await ctx.reply(quarantineErrorText(), htmlOptions());
  }
}
