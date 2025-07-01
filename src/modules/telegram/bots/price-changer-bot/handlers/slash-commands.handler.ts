import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/mongo/services/yandex-market.service';
import { TelegramUserService } from '../../shared/services/user-subscription.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { SharedCommandsHandler } from './shared-commands.handler';

export class SlashCommandsHandler {
  private sharedHandlers: SharedCommandsHandler;

  constructor(
    private bot: TTelegrafBot,
    private keyboard: ITelegramKeyboard,
    private userService: TelegramUserService,
  ) {
    this.sharedHandlers = new SharedCommandsHandler(keyboard);
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

    // /price - установить коэффициент цены
    this.bot.command('price', async (ctx) => {
      await this.sharedHandlers.handlePriceCoefficientCommand(ctx);
    });

    // /upload - загрузить прайс-лист
    this.bot.command('upload', async (ctx) => {
      await this.sharedHandlers.handleUploadPriceListCommand(ctx);
    });

    // /profile - профиль
    this.bot.command('profile', async (ctx) => {
      const user = await this.userService.handleUser(ctx.from);
      const subscription = await this.userService.checkUserSubscription(
        ctx.from,
      );

      const profileMessage = `👤 **Ваш профиль**

👨‍💼 **Пользователь:** ${ctx.from.first_name} ${ctx.from.last_name || ''}
🆔 **ID:** \`${ctx.from.id}\`
📧 **Username:** @${ctx.from.username || 'не указан'}

💳 **Подписка:** ${
        subscription.hasActiveSubscription ? '✅ Активна' : '❌ Неактивна'
      }
${
  subscription.subscription
    ? `📅 **До:** ${new Date(subscription.subscription.expires_at).toLocaleDateString('ru-RU')}`
    : ''
}

    📊 **Статистика:**
    • **Регистрация:** ${new Date(user.created_at).toLocaleDateString('ru-RU')}
    • **Последняя активность:** сегодня
    • **Обновлений цен:** 156`;

      const keyboard = await this.keyboard.createInlineButtons([
        {
          text: '💳 Управление подпиской',
          callback_data: 'manage_subscription',
        },
        { text: '🔧 Настройки профиля', callback_data: 'profile_settings' },
        { text: '📊 Подробная статистика', callback_data: 'detailed_stats' },
      ]);

      await ctx.reply(profileMessage, keyboard);
    });

    // /help - помощь
    this.bot.command('help', async (ctx) => {
      const helpMessage = `❓ **Справка по боту**

        🎯 **Основные функции:**
        • Изменение цен на товары в Яндекс.Маркете
        • Загрузка и обработка прайс-листов
        • Массовое обновление коэффициентов
        • Статистика продаж и изменений

        🔧 **Настройка:**
        1. Добавьте API-ключ от Яндекс.Маркета
        2. Укажите ID кампании и бизнеса
        3. Загрузите прайс-лист
        4. Настройте коэффициенты

        📋 **Команды:**
        /start - Запуск бота
        /menu - Главное меню
        /settings - Настройки
        /price - Установить коэффициент
        /upload - Загрузить прайс-лист
        /files - Управление файлами
        /cleanup - Очистить старые файлы
        /profile - Профиль
        /help - Эта справка

💬 **Поддержка:** @Vitality45
🌐 **Канал новостей:** @YandexMarketBot`;

      const keyboard = await this.keyboard.createInlineButtons([
        { text: '🚀 Быстрый старт', callback_data: 'quick_start' },
        { text: '📖 Подробная инструкция', callback_data: 'detailed_guide' },
        { text: '💬 Связаться с поддержкой', callback_data: 'contact_support' },
      ]);

      await ctx.reply(helpMessage, keyboard);
    });
  }

  /**
   * Настройка команд бота (для меню слева от поля ввода)
   */
  public async setupBotCommands() {
    try {
      await this.bot.telegram.setMyCommands([
        { command: 'start', description: '🏠 Запустить бота' },
        { command: 'menu', description: '📋 Главное меню' },
        { command: 'settings', description: '⚙️ Настройки' },
        { command: 'price', description: '💰 Установить коэффициент цены' },
        { command: 'upload', description: '📄 Загрузить прайс-лист' },
        { command: 'files', description: '📋 Управление файлами' },
        { command: 'cleanup', description: '🧹 Очистить старые файлы' },
        { command: 'profile', description: '👤 Профиль' },
        { command: 'help', description: '❓ Помощь' },
      ]);
      console.log('Bot commands set successfully');
    } catch (error) {
      console.error('Error setting bot commands:', error);
    }
  }
}
