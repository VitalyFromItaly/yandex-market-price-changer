import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/mongo/services/yandex-market.service';
import { TelegramUserService } from '../../shared/services/user-subscription.service';
import { SharedCommandsHandler } from './shared-commands.handler';

export class MenuCommandsHandler {
  private sharedHandlers: SharedCommandsHandler;

  constructor(
    private bot: TTelegrafBot,
    private keyboard: ITelegramKeyboard,
    private userService: TelegramUserService,
  ) {
    this.sharedHandlers = new SharedCommandsHandler(keyboard);
  }

  public setupHandlers() {
    console.log('Setting up menu commands handlers...');

    // Настройки
    this.bot.hears('⚙️ Настройки', async (ctx) => {
      const inlineKeyboard = await this.keyboard.createInlineButtons([
        { text: '🔧 Настройки API', callback_data: 'settings_api' },
        { text: '💳 Подписка', callback_data: 'settings_subscription' },
      ]);

      await ctx.reply('⚙️ Выберите настройку:', inlineKeyboard);
    });

    // Установить коэффициент цены
    this.bot.hears('💰 Установить коэффициент цены', async (ctx) => {
      await this.sharedHandlers.handlePriceCoefficientCommand(ctx);
    });

    // Обработчики готовых значений коэффициентов (кнопки)
    this.bot.hears(/^x(0\.\d+|[12]\.\d+)/, async (ctx) => {
      await this.handleCoefficientInput(ctx, ctx.match[0]);
    });

    // Обработчик числового ввода коэффициента
    this.bot.hears(/^(\d*\.?\d+)$/, async (ctx) => {
      // Проверяем, что это похоже на коэффициент (число от 0.1 до 10)
      const value = parseFloat(ctx.message.text);
      if (value >= 0.1 && value <= 10) {
        await this.handleCoefficientInput(ctx, ctx.message.text);
      }
    });

    // Загрузить прайс-лист
    this.bot.hears('📄 Загрузить прайс-лист', async (ctx) => {
      await this.sharedHandlers.handleUploadPriceListCommand(ctx);
    });

    // Помощь
    this.bot.hears('❓ Помощь', async (ctx) => {
      const helpMessage = `❓ Справка по боту

      🎯 Основные функции:
      • Изменение цен на товары в Яндекс.Маркете
      • Загрузка прайс-листов
      • Массовое обновление коэффициентов
      • Статистика продаж

      🔧 Настройка:
      1. Добавьте API-ключ от Яндекс.Маркета
      2. Укажите ID кампании и бизнеса
      3. Настройте коэффициенты
      4. Загрузите прайс-лист

      💬 Поддержка: @Vitality45`;

      await ctx.reply(helpMessage);
    });

    // Профиль
    this.bot.hears('👤 Профиль', async (ctx) => {
      const user = await this.userService.handleUser(ctx.from);
      const subscription = await this.userService.checkUserSubscription(
        ctx.from,
      );

      const profileMessage = `👤 Ваш профиль

      👨‍💼 Пользователь: ${ctx.from.first_name} ${ctx.from.last_name || ''}
      🆔 ID: ${ctx.from.id}
      📧 Username: @${ctx.from.username || 'не указан'}

      💳 Подписка: ${subscription.hasActiveSubscription ? '✅ Активна' : '❌ Неактивна'}
      ${subscription.subscription ? `📅 До: ${new Date(subscription.subscription.expires_at).toLocaleDateString('ru-RU')}` : ''}

      📊 Статистика:
      • Регистрация: ${new Date(user.created_at).toLocaleDateString('ru-RU')}
      • Последняя активность: сегодня`;

      const keyboard = await this.keyboard.createInlineButtons([
        {
          text: '💳 Управление подпиской',
          callback_data: 'manage_subscription',
        },
        { text: '🔧 Настройки профиля', callback_data: 'profile_settings' },
      ]);

      await ctx.reply(profileMessage, keyboard);
    });

    // Главное меню
    this.bot.hears('🏠 Главное меню', async (ctx) => {
      const keyboard = await this.keyboard.createKeyboard([
        ['📊 Статистика', '⚙️ Настройки'],
        ['💰 Установить коэффициент цены'],
        ['📄 Загрузить прайс-лист'],
        ['❓ Помощь', '👤 Профиль'],
      ]);
      await ctx.reply('🏠 Главное меню:', keyboard);
    });
  }

  /**
   * Обработка ввода коэффициента (кнопки или текст)
   */
  private async handleCoefficientInput(ctx: any, input: string): Promise<void> {
    await this.sharedHandlers.handleCoefficientInput(ctx, input);
  }
}
