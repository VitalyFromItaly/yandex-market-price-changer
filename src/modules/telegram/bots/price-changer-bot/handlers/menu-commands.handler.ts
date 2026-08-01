import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { helpText } from '../help.text';
import { MENU } from '../menu.constants';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { profileText } from '../profile.text';
import { MENU_TO_REPORT } from '../report-buttons';
import { settingsKeyboardRows, settingsText } from '../settings.text';

import { AdminUsersHandler } from './admin-users.handler';
import { ReportsHandler } from './reports.handler';
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
    private accessService: UserAccessService,
    private config: AppConfigService,
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
    bot.hears(MENU.PROFIT, (ctx) => this.reportsHandler.handle(ctx, MENU_TO_REPORT[MENU.PROFIT]));
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
    // isAdmin передаём обязательно: без него раскладка собирается без ряда
    // «👥 Пользователи», и администратор терял кнопку, просто нажав «Главное
    // меню» — вернуть её удавалось только через /start.
    const account = await this.accessService.findByUserAndBot(
      ctx.from.id.toString(),
      ctx.botInfo.id.toString(),
    );
    const keyboard = await this.keyboard.createMenuKeyboard(
      this.config.isAdmin(ctx.from.id),
      account?.features,
    );
    // await обязателен: без него ошибка отправки теряется мимо bot.catch, и
    // кнопка «Главное меню» молча не срабатывает.
    await ctx.reply(MENU.MAIN, keyboard);
  }

  private async showApiSettings(ctx: Context) {
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    // Текст И кнопки — из settings.text.ts, общие с `/settings` и с inline
    // «👀 Проверить настройки». Кнопки правят ставки расчёта прибыли.
    const keyboard = await this.keyboard.createInlineKeyboardMatrix(settingsKeyboardRows(store));
    await ctx.reply(settingsText(store), htmlOptions({ reply_markup: keyboard.reply_markup }));
  }

  private async showProfile(ctx: Context) {
    // Текст — из profile.text.ts, общий с командой /profile. Пока их было два,
    // они разошлись: кнопка показывала три поля, команда — шесть.
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    const access = await this.accessService.findByUserAndBot(
      ctx.from.id.toString(),
      ctx.botInfo.id.toString(),
    );

    await ctx.reply(
      profileText({
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        telegramUserId: ctx.from.id,
        username: ctx.from.username,
        accessStatus: access?.status,
        storeName: store?.name,
        configured: !!(store?.campaign_id && store?.business_id && store?.token),
        registeredAt: access?.createdAt ? new Date(access.createdAt) : undefined,
      }),
      htmlOptions(),
    );
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
