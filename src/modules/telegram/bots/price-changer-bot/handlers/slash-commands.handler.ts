import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { placementOfCampaign } from '../../../../yandex/stocks/placement';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { commandsFor } from '../bot-commands';
import { helpText } from '../help.text';
import { MENU } from '../menu.constants';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { profileText, profileView } from '../profile.text';
import { settingsKeyboardRows, settingsText } from '../settings.text';

import { SharedCommandsHandler } from './shared-commands.handler';

@Injectable()
export class SlashCommandsHandler {
  constructor(
    private keyboard: PriceChangerKeyboard,
    private accessService: UserAccessService,
    private yandexMarketService: YandexMarketService,
    private sharedHandlers: SharedCommandsHandler,
    private config: AppConfigService,
  ) {}

  public register(bot: TTelegrafBot) {
    console.log('Setting up slash commands handlers...');

    // /menu - главное меню
    bot.command('menu', async (ctx) => {
      const account = await this.accessService.findByUserAndBot(
        ctx.from.id.toString(),
        ctx.botInfo.id.toString(),
      );
      // Без магазина — сокращённое меню, как в «Главное меню» и /start; кнопка
      // «Сменить магазин» — при >1 магазине (из кэша `stores`, без API).
      const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
      const keyboard = await this.keyboard.buildMainKeyboard(
        !!(store?.campaign_id && store?.business_id && store?.token),
        this.config.isAdmin(ctx.from.id),
        account?.features,
        (store?.stores?.length ?? 0) > 1,
        placementOfCampaign(store?.stores, store?.campaign_id),
      );
      // Подпись та же, что у кнопки: раньше здесь было «📋 Главное меню:», в
      // ветке main_menu — «🏠 Главное меню:» плюс отдельное «Выберите
      // действие:», а у кнопки — «🏠 Главное меню». Три текста на один экран.
      await ctx.reply(MENU.MAIN, keyboard);
    });

    // /settings - настройки
    // Текст — из settings.text.ts, общий с кнопкой «⚙️ Настройки». Раньше
    // команда вела в собственное меню из двух inline-кнопок, причём вторая
    // («🔄 Автообновление») обработчика не имела вовсе и отвечала
    // «Неизвестная команда: settings_auto_update».
    bot.command('settings', async (ctx) => {
      const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
      // Фичи — для кнопки «📣 Продвижение»: она гейтится, и клавиатура обязана
      // говорить то же, что гейт.
      const account = await this.accessService.findByUserAndBot(
        ctx.from.id.toString(),
        ctx.botInfo.id.toString(),
      );
      // Клавиатура — тоже из settings.text.ts: кнопки правки ставок обязаны быть
      // на экране, из какого бы входа он ни открылся.
      const keyboard = await this.keyboard.createInlineKeyboardMatrix(
        settingsKeyboardRows(store, account?.features),
      );
      await ctx.reply(
        settingsText(store, account?.features),
        htmlOptions({ reply_markup: keyboard.reply_markup }),
      );
    });

    // /price и /upload сняты (TASK-009): изменение цен по API отключено,
    // бот переведён в read-only режим. Обработчики в SharedCommandsHandler
    // помечены @deprecated и оставлены как справочный материал.

    // /profile - профиль
    // Текст — из profile.text.ts, общий с кнопкой «📊 Мой профиль».
    // Блок «Статистика» убран вместе с подпиской: «Обновлений цен: 156» было
    // зашитым числом, одинаковым для всех пользователей.
    bot.command('profile', async (ctx) => {
      const access = await this.accessService.findByUserAndBot(
        ctx.from.id.toString(),
        ctx.botInfo.id.toString(),
      );
      const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());

      const keyboard = await this.keyboard.createInlineButtons([
        { text: MENU.SETTINGS, callback_data: 'settings_api' },
        { text: MENU.MAIN, callback_data: 'main_menu' },
      ]);

      await ctx.reply(
        profileText(
          profileView({
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
            telegramUserId: ctx.from.id,
            username: ctx.from.username,
            isAdmin: this.config.isAdmin(ctx.from.id),
            access,
            store,
          }),
        ),
        htmlOptions(keyboard),
      );
    });

    // /help - помощь
    // Текст — из help.text.ts, общий с кнопкой «Помощь». Пока их было два,
    // они гарантированно расходились: у команды был свой текст, а кнопка
    // вообще вела в главное меню.
    bot.command('help', async (ctx) => {
      await ctx.reply(helpText(), htmlOptions());
    });
  }

  /**
   * Умолчание списка команд бота — синей кнопки «Меню» слева от поля ввода.
   *
   * Ставится ГОСТЕВОЙ список, а не полный. Умолчание достаётся тому, кому не
   * поставлен персональный список по чату, то есть человеку без доступа: полный
   * список показывал ему пять команд, каждая из которых отвечала «Сначала нужно
   * подать заявку на доступ». Полный ставит `BotCommandsService` — персонально
   * и по факту одобрения.
   *
   * Сами списки живут в `bot-commands.ts` — рядом друг с другом и без Nest,
   * чтобы совпадение с реально зарегистрированными командами проверялось
   * тестом. Команда, которую бот рекламирует, но не обрабатывает, молча не
   * работает — так уже случилось с /files и /cleanup.
   */
  public async setupBotCommands(bot: TTelegrafBot) {
    try {
      await bot.telegram.setMyCommands(commandsFor('guest'));
      console.log('Bot commands set successfully');
    } catch (error) {
      console.error('Error setting bot commands:', error);
    }
  }
}
