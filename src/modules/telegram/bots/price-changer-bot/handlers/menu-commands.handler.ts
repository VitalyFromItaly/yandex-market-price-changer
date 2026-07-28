import { Context } from 'telegraf';
import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TelegramUserService } from '../../shared/services/telegram-user.service';
import { SharedCommandsHandler } from './shared-commands.handler';

export class MenuCommandsHandler {
  private sharedCommandsHandler: SharedCommandsHandler;

  constructor(
    private bot: TTelegrafBot,
    private keyboard: ITelegramKeyboard,
    private userService: TelegramUserService,
    private yandexMarketService: YandexMarketService
  ) {
    this.sharedCommandsHandler = new SharedCommandsHandler(this.keyboard, this.yandexMarketService);
  }

  public setupHandlers() {
    // Подписи должны совпадать с PriceChangerKeyboard.menuCommands —
    // пока это два независимых списка (сведение в один источник: TASK-014).
    // Кнопки «Изменить цены» и «Обновить коэффициент» сняты (TASK-009).
    this.bot.hears('🏠 Главное меню', (ctx) => this.showMainMenu(ctx));
    this.bot.hears('⚙️ Настройки API', (ctx) => this.showApiSettings(ctx));
    this.bot.hears('📊 Мой профиль', (ctx) => this.showProfile(ctx));
    this.bot.hears('❓ Помощь', (ctx) => this.showMainMenu(ctx));
  }

  private async showMainMenu(ctx: Context) {
    const keyboard = await this.keyboard.createMenuKeyboard();
    ctx.reply('🏠 Главное меню', keyboard);
  }

  private async showApiSettings(ctx: Context) {
    const yandexSettings = await this.yandexMarketService.findByTelegramUser(
      ctx.from.id.toString()
    );

    const message = `⚙️ Настройки API

🔑 **Campaign ID**: ${yandexSettings?.campaign_id || 'Не установлен'}
🏢 **Business ID**: ${yandexSettings?.business_id || 'Не установлен'}
🎫 **Token**: ${yandexSettings?.token ? '✅ Установлен' : '❌ Не установлен'}

📝 Для изменения настроек просто отправьте новые данные в формате:
\`Campaign ID: ваш_id\`
\`Business ID: ваш_id\`
\`Token: ваш_токен\``;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  }

  private async showProfile(ctx: Context) {
    const subscription = await this.userService.checkUserSubscription(ctx.from);

    const message = `📊 Мой профиль

👤 **Пользователь**: ${ctx.from.first_name} ${ctx.from.last_name || ''}
🆔 **ID**: ${ctx.from.id}
📅 **Подписка**: ${subscription ? '✅ Активна' : '❌ Неактивна'}`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  }

  /** @deprecated Кнопка «Изменить цены» снята (TASK-009). Не вызывается. */
  private async changePrices(ctx: Context) {
    await this.sharedCommandsHandler.handleUploadPriceListCommand(ctx);
  }

  /** @deprecated Кнопка «Обновить коэффициент» снята (TASK-009). Не вызывается. */
  private async updateCoefficient(ctx: Context) {
    await this.sharedCommandsHandler.handlePriceCoefficientCommand(ctx);
  }
}
