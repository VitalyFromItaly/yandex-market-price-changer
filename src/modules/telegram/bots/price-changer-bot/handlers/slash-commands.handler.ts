import { Injectable } from '@nestjs/common';

import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { MENU } from '../menu.constants';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

import { SharedCommandsHandler } from './shared-commands.handler';

@Injectable()
export class SlashCommandsHandler {
  constructor(
    private keyboard: PriceChangerKeyboard,
    private accessService: UserAccessService,
    private yandexMarketService: YandexMarketService,
    private sharedHandlers: SharedCommandsHandler,
  ) {}

  public register(bot: TTelegrafBot) {
    console.log('Setting up slash commands handlers...');

    // /menu - главное меню
    bot.command('menu', async (ctx) => {
      const keyboard = await this.keyboard.createMenuKeyboard();
      await ctx.reply('📋 Главное меню:', keyboard);
    });

    // /settings - настройки
    bot.command('settings', async (ctx) => {
      const inlineKeyboard = await this.keyboard.createInlineButtons([
        { text: MENU.SETTINGS, callback_data: 'settings_api' },
        { text: '🔄 Автообновление', callback_data: 'settings_auto_update' },
      ]);

      await ctx.reply('⚙️ Выберите настройку:', inlineKeyboard);
    });

    // /price и /upload сняты (TASK-009): изменение цен по API отключено,
    // бот переведён в read-only режим. Обработчики в SharedCommandsHandler
    // помечены @deprecated и оставлены как справочный материал.

    // /profile - профиль
    bot.command('profile', async (ctx) => {
      const access = await this.accessService.findByUserAndBot(
        ctx.from.id.toString(),
        ctx.botInfo.id.toString(),
      );
      const settings = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
      const configured = !!(settings?.campaign_id && settings?.business_id && settings?.token);

      // Блок «Статистика» убран вместе с подпиской: «Обновлений цен: 156» было
      // зашитым числом, одинаковым для всех пользователей.
      const profileMessage = `👤 <b>Ваш профиль</b>

👨‍💼 <b>Пользователь:</b> ${esc(ctx.from.first_name)} ${esc(ctx.from.last_name || '')}
🆔 <b>ID:</b> <code>${ctx.from.id}</code>
📧 <b>Username:</b> @${esc(ctx.from.username || 'не указан')}

✅ <b>Доступ:</b> ${this.accessLabel(access?.status)}
⚙️ <b>Настройки API:</b> ${configured ? '✅ Заполнены' : '❌ Не заполнены'}${
        access?.createdAt
          ? `\n📅 <b>Регистрация:</b> ${new Date(access.createdAt).toLocaleDateString('ru-RU')}`
          : ''
      }`;

      const keyboard = await this.keyboard.createInlineButtons([
        { text: MENU.SETTINGS, callback_data: 'settings_api' },
        { text: MENU.MAIN, callback_data: 'main_menu' },
      ]);

      await ctx.reply(profileMessage, htmlOptions(keyboard));
    });

    // /help - помощь
    bot.command('help', async (ctx) => {
      const helpMessage = `❓ <b>Справка по боту</b>

        🎯 <b>Что умеет бот:</b>
        • Показывает отчёты по заказам Яндекс.Маркета
        • Работает только на чтение — ничего не меняет в вашем магазине

        🔧 <b>Настройка:</b>
        1. Добавьте API-ключ от Яндекс.Маркета
        2. Укажите ID кампании и бизнеса

        📋 <b>Команды:</b>
        /start - Запуск бота
        /menu - Главное меню
        /settings - Настройки
        /profile - Профиль
        /help - Эта справка

💬 <b>Поддержка:</b> @Vitality45
🌐 <b>Канал новостей:</b> @YandexMarketBot`;

      const keyboard = await this.keyboard.createInlineButtons([
        { text: '🚀 Быстрый старт', callback_data: 'quick_start' },
        { text: '📖 Подробная инструкция', callback_data: 'detailed_guide' },
        { text: '💬 Связаться с поддержкой', callback_data: 'contact_support' },
      ]);

      await ctx.reply(helpMessage, htmlOptions(keyboard));
    });
  }

  private accessLabel(status: string | undefined): string {
    switch (status) {
      case 'approved':
        return '✅ Выдан';
      case 'pending':
        return '⏳ Заявка на рассмотрении';
      case 'rejected':
        return '⛔ Отклонена';
      default:
        return '❌ Заявка не подана';
    }
  }

  /**
   * Настройка команд бота (для меню слева от поля ввода)
   */
  public async setupBotCommands(bot: TTelegrafBot) {
    try {
      // Список должен содержать ТОЛЬКО реально зарегистрированные команды.
      // Убраны: /price и /upload (изменение цен отключено, TASK-009),
      // а также /files и /cleanup — их обработчики были удалены ещё при
      // миграции, но команды продолжали рекламироваться и молча не работали.
      // Список содержит ТОЛЬКО реально зарегистрированные команды. Отчёты
      // вызываются кнопками меню, а не слэш-командами, поэтому в setMyCommands
      // их нет: команда, которую бот рекламирует, но не обрабатывает, молча не
      // работает — так уже случилось с /files и /cleanup.
      await bot.telegram.setMyCommands([
        { command: 'start', description: '🏠 Запустить бота' },
        { command: 'menu', description: '📋 Меню и отчёты' },
        { command: 'settings', description: '⚙️ Настройки' },
        { command: 'profile', description: '👤 Профиль' },
        { command: 'help', description: '❓ Помощь' },
        // /users намеренно НЕ здесь: список команд общий для всех, а раздел
        // администратора не должен светиться у обычных пользователей.
      ]);
      console.log('Bot commands set successfully');
    } catch (error) {
      console.error('Error setting bot commands:', error);
    }
  }
}
