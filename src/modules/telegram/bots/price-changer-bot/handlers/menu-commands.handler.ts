import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { MENU } from '../menu.constants';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

import { AdminUsersHandler } from './admin-users.handler';
import { MENU_TO_REPORT, ReportsHandler } from './reports.handler';
import { ScheduleHandler } from './schedule.handler';
import { SharedCommandsHandler } from './shared-commands.handler';

@Injectable()
export class MenuCommandsHandler {
  constructor(
    private keyboard: PriceChangerKeyboard,
    private yandexMarketService: YandexMarketService,
    private sharedCommandsHandler: SharedCommandsHandler,
    private adminUsers: AdminUsersHandler,
    private reportsHandler: ReportsHandler,
    private scheduleHandler: ScheduleHandler,
  ) {}

  public register(bot: TTelegrafBot) {
    // Подписи — из menu.constants, единственного источника (TASK-014).
    bot.hears(MENU.MAIN, (ctx) => this.showMainMenu(ctx));
    // Четыре отчёта. hears объявлены здесь, потому что здесь же живёт весь
    // роутинг reply-кнопок, а инвариант menu-labels требует пару «метка ↔ hears»
    // в одном файле. Сама работа — в ReportsHandler.
    bot.hears(MENU.SHIPPED_TODAY, (ctx) =>
      this.reportsHandler.handle(ctx, MENU_TO_REPORT[MENU.SHIPPED_TODAY]),
    );
    bot.hears(MENU.REDEEMED, (ctx) =>
      this.reportsHandler.handle(ctx, MENU_TO_REPORT[MENU.REDEEMED]),
    );
    bot.hears(MENU.RETURNING, (ctx) =>
      this.reportsHandler.handle(ctx, MENU_TO_REPORT[MENU.RETURNING]),
    );
    bot.hears(MENU.IN_TRANSIT, (ctx) =>
      this.reportsHandler.handle(ctx, MENU_TO_REPORT[MENU.IN_TRANSIT]),
    );
    bot.hears(MENU.SCHEDULE, (ctx) => this.scheduleHandler.showMenu(ctx));
    bot.hears(MENU.SETTINGS, (ctx) => this.showApiSettings(ctx));
    bot.hears(MENU.PROFILE, (ctx) => this.showProfile(ctx));
    // Раздел администратора. Кнопки нет в общей раскладке, но проверка прав
    // всё равно внутри обработчика: полагаться на то, что нарисовано на
    // экране, нельзя — callback можно послать и вручную.
    bot.hears(MENU.USERS, async (ctx) => {
      if (!this.adminUsers.isAdmin(ctx.from.id)) return;
      await this.adminUsers.sendList(ctx);
    });
    bot.hears(MENU.HELP, (ctx) => this.showMainMenu(ctx));
  }

  private async showMainMenu(ctx: Context) {
    const keyboard = await this.keyboard.createMenuKeyboard();
    // await обязателен: без него ошибка отправки теряется мимо bot.catch, и
    // кнопка «Главное меню» молча не срабатывает.
    await ctx.reply('🏠 Главное меню', keyboard);
  }

  private async showApiSettings(ctx: Context) {
    const yandexSettings = await this.yandexMarketService.findByTelegramUser(
      ctx.from.id.toString(),
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
    // Имя и фамилия — произвольный текст от пользователя: один символ `<`
    // в имени ломал разметку всего сообщения и давал 400 от Telegram.
    const settings = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    const configured = !!(settings?.campaign_id && settings?.business_id && settings?.token);

    const message = `📊 Мой профиль

👤 <b>Пользователь</b>: ${esc(ctx.from.first_name)} ${esc(ctx.from.last_name || '')}
🆔 <b>ID</b>: ${ctx.from.id}
⚙️ <b>Настройки API</b>: ${configured ? '✅ Заполнены' : '❌ Не заполнены'}`;

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
