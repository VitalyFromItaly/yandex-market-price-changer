import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { ADMIN_CB_PATTERN, parseAdminCallback } from '../../shared/access.domain';
import { AdminNotifierService } from '../../shared/services/admin-notifier.service';
import { ACCESS_GRANTED_TEXT, accessRejectedText } from '../access-decision.text';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

/**
 * Кнопки «Одобрить» / «Отклонить» на карточке заявки.
 *
 * Почему отдельный шаг, а не ветка в общем обработчике callback_query.
 * callback_data здесь параметризован (несёт id заявителя), а весь роутинг в
 * проекте — плоский switch по точным строкам с default-веткой, которая
 * перезаписывает сообщение. bot.action в telegraf — это тот же
 * on('callback_query') плюс сопоставление с шаблоном, и next() он НЕ вызывает.
 * Поэтому админский колбэк до общего switch не доходит, а сам switch остаётся
 * нетронутым.
 *
 * Здесь же первая в кодовой базе проверка ctx.from.id: гейт доступа админов
 * пропускает всегда, но нажать кнопку на карточке не должен никто, кроме них.
 */
@Injectable()
export class AdminApprovalHandler {
  private readonly logger = new Logger(AdminApprovalHandler.name);

  constructor(
    private readonly accessService: UserAccessService,
    private readonly yandexMarketService: YandexMarketService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly keyboard: PriceChangerKeyboard,
    private readonly config: AppConfigService,
  ) {}

  public register(bot: TTelegrafBot) {
    bot.action(ADMIN_CB_PATTERN, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string }).data;
      const parsed = parseAdminCallback(data);
      if (!parsed) {
        await ctx.answerCbQuery('Не удалось разобрать кнопку');
        return;
      }

      if (!this.config.isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('Недостаточно прав', { show_alert: true });
        return;
      }

      const botId = ctx.botInfo.id.toString();
      const decided = await this.accessService.decide(
        parsed.telegramUserId,
        botId,
        parsed.decision,
        { id: ctx.from.id.toString(), username: ctx.from.username },
      );

      if (!decided) {
        await this.reportAlreadyDecided(ctx, parsed.telegramUserId, botId);
        return;
      }

      // Отвечаем на callback ровно один раз: повторный ответ на тот же
      // callback_query Telegram встречает четырёхсотой.
      await ctx.answerCbQuery(parsed.decision === 'approve' ? 'Одобрено' : 'Отклонено');

      if (parsed.decision === 'reject') {
        // Отклонённые креды не храним.
        await this.yandexMarketService.deleteByTelegramUser(parsed.telegramUserId);
      }

      const store = await this.yandexMarketService.findByTelegramUser(parsed.telegramUserId);
      await this.adminNotifier.finalizeCards(ctx, decided, store);
      await this.notifyApplicant(ctx, decided);
    });
  }

  private async reportAlreadyDecided(
    ctx: Context,
    telegramUserId: string,
    botId: string,
  ): Promise<void> {
    const access = await this.accessService.findByUserAndBot(telegramUserId, botId);
    const who = access?.decidedByUsername
      ? `@${access.decidedByUsername}`
      : (access?.decidedBy ?? 'другим администратором');

    await ctx.answerCbQuery(`Заявка уже обработана: ${who}`, { show_alert: true });

    if (access) {
      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      await this.adminNotifier.finalizeCards(ctx, access, store);
    }
  }

  /**
   * Сообщить заявителю о решении. Пользователь мог заблокировать бота — это не
   * повод считать обработку решения неуспешной.
   */
  private async notifyApplicant(
    ctx: Context,
    access: Awaited<ReturnType<UserAccessService['decide']>>,
  ): Promise<void> {
    try {
      if (access.status === 'approved') {
        // Раскладку собираем для ЗАЯВИТЕЛЯ, а не для нажавшего кнопку админа:
        // ctx.from здесь — администратор, и его права к меню получателя
        // отношения не имеют.
        const kb = await this.keyboard.createMenuKeyboard(
          this.config.isAdmin(access.telegramUserId),
          access.features,
        );
        // Текст — из access-decision.text.ts, общего с веб-панелью: она умеет
        // открывать доступ тем же тумблером, и две копии этой фразы разошлись
        // бы ровно так же, как когда-то разошлись экраны справки.
        await ctx.telegram.sendMessage(access.telegramChatId, ACCESS_GRANTED_TEXT, htmlOptions(kb));
        return;
      }

      await ctx.telegram.sendMessage(
        access.telegramChatId,
        accessRejectedText(access.rejectedAt),
        htmlOptions(),
      );
    } catch (error) {
      this.logger.warn(`Не удалось уведомить пользователя ${access.telegramUserId}: ${error}`);
    }
  }
}
