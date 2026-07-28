import { Context } from 'telegraf';
import { Injectable } from '@nestjs/common';
import { MENU } from '../menu.constants';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TelegramUserService } from '../../shared/services/telegram-user.service';
import { SharedCommandsHandler } from './shared-commands.handler';

@Injectable()
export class MenuCommandsHandler {
  constructor(
    private keyboard: PriceChangerKeyboard,
    private userService: TelegramUserService,
    private yandexMarketService: YandexMarketService,
    private sharedCommandsHandler: SharedCommandsHandler,
  ) {}

  public register(bot: TTelegrafBot) {
    // Подписи — из menu.constants, единственного источника (TASK-014).
    bot.hears(MENU.MAIN, (ctx) => this.showMainMenu(ctx));
    bot.hears(MENU.SETTINGS, (ctx) => this.showApiSettings(ctx));
    bot.hears(MENU.PROFILE, (ctx) => this.showProfile(ctx));
    bot.hears(MENU.HELP, (ctx) => this.showMainMenu(ctx));
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

🔑 <b>Campaign ID</b>: ${esc(yandexSettings?.campaign_id) || 'Не установлен'}
🏢 <b>Business ID</b>: ${esc(yandexSettings?.business_id) || 'Не установлен'}
🎫 <b>Token</b>: ${yandexSettings?.token ? '✅ Установлен' : '❌ Не установлен'}

📝 Для изменения настроек просто отправьте новые данные в формате:
<code>Campaign ID: ваш_id</code>
<code>Business ID: ваш_id</code>
<code>Token: ваш_токен</code>`;

    await ctx.reply(message, htmlOptions());
  }

  private async showProfile(ctx: Context) {
    const subscription = await this.userService.checkUserSubscription(ctx.from, ctx.botInfo.id);

    const message = `📊 Мой профиль

👤 <b>Пользователь</b>: ${ctx.from.first_name} ${ctx.from.last_name || ''}
🆔 <b>ID</b>: ${ctx.from.id}
📅 <b>Подписка</b>: ${subscription ? '✅ Активна' : '❌ Неактивна'}`;

    await ctx.reply(message, htmlOptions());
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
