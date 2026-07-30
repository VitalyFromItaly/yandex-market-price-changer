import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { code, esc, htmlOptions } from '../../../formatting/telegram-format';
import { helpText } from '../help.text';
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
    bot.hears(MENU.HELP, async (ctx) => await ctx.reply(helpText(), htmlOptions()));
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

    const configured = !!(
      yandexSettings?.campaign_id &&
      yandexSettings?.business_id &&
      yandexSettings?.token
    );

    // Идентификаторы пользователю НЕ показываем. Продавцу они ни о чём не
    // говорят, а места занимают больше, чем название магазина. Раньше здесь
    // печатались оба числа, и экран выглядел технической выкладкой.
    const lines = ['⚙️ <b>Настройки API</b>', ''];

    if (configured) {
      lines.push(`🏪 Магазин: ${esc(yandexSettings?.name) || '✅ подключён'}`, '');
    } else {
      lines.push('🏪 Магазин: ❌ не подключён', '');
    }

    if (configured) {
      // Прежний текст предлагал прислать все три значения разом в формате
      // «Campaign ID: ...». Так бот работал ДО визарда; теперь он спрашивает
      // по одному, а два значения определяет сам, и старая инструкция уводила
      // пользователя в сторону.
      lines.push(
        'Магазин подключён. Чтобы сменить магазин или токен —',
        `пришлите новый токен сообщением: ${code('token: ваш_токен')}`,
      );
    } else {
      lines.push(
        'Магазин не подключён. Пришлите API-токен одним сообщением —',
        'Campaign ID и Business ID бот определит сам.',
      );
    }

    await ctx.reply(lines.join('\n'), htmlOptions());
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
