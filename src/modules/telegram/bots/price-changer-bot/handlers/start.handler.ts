import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { TTelegrafBot } from '../../../domain.telegram';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { htmlOptions } from '../../../formatting/telegram-format';
import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { hoursUntilRetry, isRejectionExpired } from '../../shared/access.domain';

/**
 * Обработчик /start — единственная команда, доступная при любом статусе
 * доступа. Гейт (AccessGateHandler) пропускает её всегда, поэтому именно здесь
 * пользователь узнаёт, что с ним происходит: заявка на рассмотрении, отказ или
 * пора вводить креды.
 *
 * Раньше здесь стояла проверка подписки — единственная во всём приложении,
 * из-за чего загрузка файла её просто обходила (TASK-036/TASK-039).
 */
@Injectable()
export class StartHandler {
  private readonly logger = new Logger(StartHandler.name);

  constructor(
    private readonly keyboard: PriceChangerKeyboard,
    private readonly accessService: UserAccessService,
    private readonly config: AppConfigService,
  ) {}

  public register(bot: TTelegrafBot) {
    bot.start(async (ctx) => {
      // ctx.botInfo telegraf заполняет сам и кэширует — отдельный getMe() не нужен.
      const botId = ctx.botInfo.id.toString();

      if (this.config.isAdmin(ctx.from.id)) {
        await this.replyApproved(ctx);
        return;
      }

      const access = await this.accessService.ensure({
        telegramUserId: ctx.from.id.toString(),
        botId,
        telegramChatId: ctx.chat.id.toString(),
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      });

      switch (access.status) {
        case 'approved':
          await this.replyApproved(ctx);
          return;

        case 'pending':
          await ctx.reply(
            [
              '⏳ Заявка на рассмотрении.',
              '',
              'Администратор проверяет ваши данные. Как только он примет решение,',
              'бот пришлёт сообщение сюда же.',
            ].join('\n'),
            htmlOptions(),
          );
          return;

        case 'rejected': {
          // Гейт снимает протухший отказ сам, но /start он пропускает ДО этой
          // проверки — иначе пользователь час видел бы «отказано» после того,
          // как запрет уже истёк.
          if (isRejectionExpired(access.rejectedAt, new Date())) {
            await this.replyOnboarding(ctx);
            return;
          }
          const hours = hoursUntilRetry(access.rejectedAt, new Date());
          await ctx.reply(
            [
              '⛔ Заявка отклонена.',
              '',
              `Повторная регистрация будет доступна через ${hours} ч.`,
            ].join('\n'),
            htmlOptions(),
          );
          return;
        }

        default:
          await this.replyOnboarding(ctx);
      }
    });
  }

  private async replyApproved(ctx: Context) {
    const welcomeMessage = [
      '🎉 Добро пожаловать!',
      '',
      'Бот показывает отчёты по заказам Яндекс.Маркета и работает только на чтение —',
      'он ничего не меняет в вашем магазине.',
      '',
      'Выберите действие из меню ниже:',
    ].join('\n');

    const kb = await this.keyboard.createMenuKeyboard();
    await ctx.reply(welcomeMessage, htmlOptions(kb));
  }

  private async replyOnboarding(ctx: Context) {
    const message = [
      '👋 Добро пожаловать!',
      '',
      'Доступ к боту выдаёт администратор. Чтобы подать заявку, пришлите три',
      'значения из личного кабинета Яндекс.Маркета — по одному сообщению:',
      '',
      '<code>Campaign ID: ваш_id</code>',
      '<code>Business ID: ваш_id</code>',
      '<code>Token: ваш_токен</code>',
      '',
      'Как только все три будут заполнены, заявка уйдёт администратору.',
    ].join('\n');

    await ctx.reply(message, htmlOptions());
  }
}
