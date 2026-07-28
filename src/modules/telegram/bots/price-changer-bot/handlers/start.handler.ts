import { Injectable, Logger } from '@nestjs/common';
import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { TelegramUserService } from '../../shared/services/telegram-user.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { htmlOptions } from '../../../formatting/telegram-format';

/**
 * Обработчик /start. Раньше жил прямо в PriceChangerBot.onStart, теперь это
 * обычный провайдер: экземпляра бота не хранит, получает его в register().
 */
@Injectable()
export class StartHandler {
  private readonly logger = new Logger(StartHandler.name);

  constructor(
    private readonly keyboard: PriceChangerKeyboard,
    private readonly userService: TelegramUserService,
  ) {}

  public register(bot: TTelegrafBot) {
    bot.start(async (ctx) => {
      // ctx.botInfo telegraf заполняет сам и кэширует — отдельный getMe() не нужен.
      const botId = ctx.botInfo.id;

      const userSubscription = await this.userService.handleUser(ctx.from, botId);
      if (!userSubscription) {
        await ctx.reply('Не удалось получить ваш профиль. Попробуйте позже.');
        return;
      }

      const subscriptionCheck = await this.userService.checkUserSubscription(ctx.from, botId);
      if (!subscriptionCheck.hasActiveSubscription) {
        const kb = await (this.keyboard as ITelegramKeyboard).createKeyboard([
          ['Написать @Vitality45'],
        ]);
        await ctx.reply(
          'Подписка закончилась. Пожалуйста, свяжитесь с @Vitality45 для оплаты',
          kb,
        );
        return;
      }

      const yandexStore = await this.userService.handleUserYandexStore(userSubscription, botId);
      if (!yandexStore) {
        await ctx.reply(
          'Не удалось получить настройки вашего магазина Яндекс Маркета. Попробуйте позже.',
        );
        return;
      }

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
    });
  }
}
