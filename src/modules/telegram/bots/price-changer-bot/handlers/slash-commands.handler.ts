import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { helpText } from '../help.text';
import { MENU } from '../menu.constants';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { profileText } from '../profile.text';
import { settingsKeyboardRows, settingsText } from '../settings.text';
import { storeTitle } from '../store-title';

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
      // Клавиатура — тоже из settings.text.ts: кнопки правки ставок обязаны быть
      // на экране, из какого бы входа он ни открылся.
      const keyboard = await this.keyboard.createInlineKeyboardMatrix(settingsKeyboardRows(store));
      await ctx.reply(settingsText(store), htmlOptions({ reply_markup: keyboard.reply_markup }));
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
   * Настройка команд бота (для меню слева от поля ввода)
   */
  public async setupBotCommands(bot: TTelegrafBot) {
    try {
      // Список должен содержать ТОЛЬКО реально зарегистрированные команды.
      // Убраны: /price и /upload (изменение цен отключено, TASK-009),
      // а также /files и /cleanup — их обработчики были удалены ещё при
      // миграции, но команды продолжали рекламироваться и молча не работали.
      // Список содержит ТОЛЬКО реально зарегистрированные команды. Отчёты
      // вызываются кнопками меню, а не слэш-командами, поэтому в setMyCommands
      // их нет: команда, которую бот рекламирует, но не обрабатывает, молча не
      // работает — так уже случилось с /files и /cleanup.
      await bot.telegram.setMyCommands([
        { command: 'start', description: '🏠 Запустить бота' },
        { command: 'menu', description: '📋 Меню и отчёты' },
        { command: 'settings', description: '⚙️ Настройки' },
        { command: 'profile', description: '👤 Профиль' },
        { command: 'help', description: '❓ Помощь' },
        // /users намеренно НЕ здесь: список команд общий для всех, а раздел
        // администратора не должен светиться у обычных пользователей.
      ]);
      console.log('Bot commands set successfully');
    } catch (error) {
      console.error('Error setting bot commands:', error);
    }
  }
}
