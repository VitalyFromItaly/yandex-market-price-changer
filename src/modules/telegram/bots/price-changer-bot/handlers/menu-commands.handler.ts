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
import { storeTitle } from '../store-title';

import { AdminUsersHandler } from './admin-users.handler';
import { ApiSettingsHandler } from './api-settings.handler';
import { FbyHandler } from './fby.handler';
import { ReportsHandler } from './reports.handler';
import { ScheduleHandler } from './schedule.handler';
import { SharedCommandsHandler } from './shared-commands.handler';
import { WarehousesHandler } from './warehouses.handler';

@Injectable()
export class MenuCommandsHandler {
  // Роутер reply-кнопок: держит обработчики, к которым разводит нажатия. Он и
  // есть список зависимостей — «сгруппировать» их в контейнер значило бы спрятать
  // состав меню за лишним слоем (тот же довод, что у PriceChangerComposer).
  // eslint-disable-next-line max-params
  constructor(
    private keyboard: PriceChangerKeyboard,
    private yandexMarketService: YandexMarketService,
    private sharedCommandsHandler: SharedCommandsHandler,
    private adminUsers: AdminUsersHandler,
    private reportsHandler: ReportsHandler,
    private scheduleHandler: ScheduleHandler,
    private warehousesHandler: WarehousesHandler,
    private fbyHandler: FbyHandler,
    private apiSettings: ApiSettingsHandler,
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
    // Обзор складов. Работа — в WarehousesHandler; здесь только пара
    // «метка ↔ hears», которую требует инвариант menu-labels.
    bot.hears(MENU.WAREHOUSES, (ctx) => this.warehousesHandler.handle(ctx));
    // Сводка FBY. Работа — в FbyHandler; здесь только пара «метка ↔ hears».
    bot.hears(MENU.FBY, (ctx) => this.fbyHandler.handle(ctx));
    bot.hears(MENU.SCHEDULE, (ctx) => this.scheduleHandler.showMenu(ctx));
    // Смена магазина. Кнопка появляется в меню только при >1 магазине; работа —
    // в ApiSettingsHandler. Пара «метка ↔ hears» требуется инвариантом menu-labels.
    bot.hears(MENU.SWITCH_STORE, (ctx) => this.apiSettings.startSwitch(ctx));
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
    // Без подключённого магазина — сокращённое меню: кнопки отчётов иначе
    // ведут в тупик «сначала подключите магазин». Касается и администратора
    // без своего магазина (он минует гейт, но не магазин). Кнопку «Сменить
    // магазин» показываем, только когда токен открывает больше одного (из
    // кэша `stores`, без похода в API).
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    const configured = !!(store?.campaign_id && store?.business_id && store?.token);

    // Добор кэша для подключившихся до появления кнопки — фоном, см.
    // ensureStoresCached. Здесь тоже, а не только в /start: главное меню
    // открывают куда чаще, и ждать от продавца перезапуска бота незачем.
    this.apiSettings.ensureStoresCached(ctx, store);

    const keyboard = await this.keyboard.buildMainKeyboard(
      configured,
      this.config.isAdmin(ctx.from.id),
      account?.features,
      (store?.stores?.length ?? 0) > 1,
    );
    // await обязателен: без него ошибка отправки теряется мимо bot.catch, и
    // кнопка «Главное меню» молча не срабатывает.
    await ctx.reply(MENU.MAIN, keyboard);
  }

  private async showApiSettings(ctx: Context) {
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    // Фичи нужны экрану: кнопка «📣 Продвижение» гейтится, и клавиатура обязана
    // говорить то же, что гейт. У админов записи нет — undefined разрешает.
    const account = await this.accessService.findByUserAndBot(
      ctx.from.id.toString(),
      ctx.botInfo.id.toString(),
    );
    // Текст И кнопки — из settings.text.ts, общие с `/settings` и с inline
    // «👀 Проверить настройки». Кнопки правят ставки расчёта прибыли.
    const keyboard = await this.keyboard.createInlineKeyboardMatrix(
      settingsKeyboardRows(store, account?.features),
    );
    await ctx.reply(
      settingsText(store, account?.features),
      htmlOptions({ reply_markup: keyboard.reply_markup }),
    );
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
        storeName: storeTitle(store),
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
