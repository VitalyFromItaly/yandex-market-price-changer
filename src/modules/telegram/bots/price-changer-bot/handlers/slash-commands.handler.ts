import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TelegramUserService } from '../../shared/services/telegram-user.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { SharedCommandsHandler } from './shared-commands.handler';
import { esc, htmlOptions } from '../../../formatting/telegram-format';

export class SlashCommandsHandler {
  private sharedHandlers: SharedCommandsHandler;

  constructor(
    private bot: TTelegrafBot,
    private keyboard: ITelegramKeyboard,
    private userService: TelegramUserService,
    private yandexMarketService: YandexMarketService,
  ) {
    this.sharedHandlers = new SharedCommandsHandler(keyboard, yandexMarketService);
  }

  public setupHandlers() {
    console.log('Setting up slash commands handlers...');

    // /menu - главное меню
    this.bot.command('menu', async (ctx) => {
      const keyboard = await this.keyboard.createMenuKeyboard();
      await ctx.reply('📋 Главное меню:', keyboard);
    });

    // /settings - настройки
    this.bot.command('settings', async (ctx) => {
      const inlineKeyboard = await this.keyboard.createInlineButtons([
        { text: '🔧 Настройки API', callback_data: 'settings_api' },
        { text: '🔄 Автообновление', callback_data: 'settings_auto_update' },
      ]);

      await ctx.reply('⚙️ Выберите настройку:', inlineKeyboard);
    });

    // /price и /upload сняты (TASK-009): изменение цен по API отключено,
    // бот переведён в read-only режим. Обработчики в SharedCommandsHandler
    // помечены @deprecated и оставлены как справочный материал.

    // /profile - профиль
    this.bot.command('profile', async (ctx) => {
      const user = await this.userService.handleUser(ctx.from);
      const subscription = await this.userService.checkUserSubscription(
        ctx.from,
      );

      const profileMessage = `👤 <b>Ваш профиль</b>

👨‍💼 <b>Пользователь:</b> ${esc(ctx.from.first_name)} ${esc(ctx.from.last_name || '')}
🆔 <b>ID:</b> <code>${ctx.from.id}</code>
📧 <b>Username:</b> @${esc(ctx.from.username || 'не указан')}

💳 <b>Подписка:</b> ${
        subscription.hasActiveSubscription ? '✅ Активна' : '❌ Неактивна'
      }
${
  subscription.subscription
    ? `📅 <b>До:</b> ${new Date(subscription.subscription.expires_at).toLocaleDateString('ru-RU')}`
    : ''
}

    📊 <b>Статистика:</b>
    • <b>Регистрация:</b> ${new Date(user.created_at).toLocaleDateString('ru-RU')}
    • <b>Последняя активность:</b> сегодня
    • <b>Обновлений цен:</b> 156`;

      const keyboard = await this.keyboard.createInlineButtons([
        {
          text: '💳 Управление подпиской',
          callback_data: 'manage_subscription',
        },
        { text: '🔧 Настройки профиля', callback_data: 'profile_settings' },
        { text: '📊 Подробная статистика', callback_data: 'detailed_stats' },
      ]);

      await ctx.reply(profileMessage, htmlOptions(keyboard));
    });

    // /help - помощь
    this.bot.command('help', async (ctx) => {
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

  /**
   * Настройка команд бота (для меню слева от поля ввода)
   */
  public async setupBotCommands() {
    try {
      // Список должен содержать ТОЛЬКО реально зарегистрированные команды.
      // Убраны: /price и /upload (изменение цен отключено, TASK-009),
      // а также /files и /cleanup — их обработчики были удалены ещё при
      // миграции, но команды продолжали рекламироваться и молча не работали.
      await this.bot.telegram.setMyCommands([
        { command: 'start', description: '🏠 Запустить бота' },
        { command: 'menu', description: '📋 Главное меню' },
        { command: 'settings', description: '⚙️ Настройки' },
        { command: 'profile', description: '👤 Профиль' },
        { command: 'help', description: '❓ Помощь' },
      ]);
      console.log('Bot commands set successfully');
    } catch (error) {
      console.error('Error setting bot commands:', error);
    }
  }
}
