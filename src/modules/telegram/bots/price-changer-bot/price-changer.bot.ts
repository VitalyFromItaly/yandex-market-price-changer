import BaseTelegramBot from '../shared/BaseTelegramBot';
import { EBotName, TTelegrafBot } from '../../domain.telegram';
import { IBotSchema } from '../../../../database/mongo/models/bot.model.mongo';
import { PriceChangerKeyboard } from './price-changer.keyboard';
import { MenuCommandsHandler } from './handlers/menu-commands.handler';
import { CallbackQueryHandler } from './handlers/callback-query.handler';
import { ApiSettingsHandler } from './handlers/api-settings.handler';
import { SlashCommandsHandler } from './handlers/slash-commands.handler';
import { FileUploadHandler } from './handlers/file-upload.handler';

export default class PriceChangerBot extends BaseTelegramBot {
  private menuCommandsHandler: MenuCommandsHandler;
  private callbackQueryHandler: CallbackQueryHandler;
  private apiSettingsHandler: ApiSettingsHandler;
  private slashCommandsHandler: SlashCommandsHandler;
  private fileUploadHandler: FileUploadHandler;

  constructor(bot: TTelegrafBot, botInfo: IBotSchema) {
    const keyboard = new PriceChangerKeyboard();
    super(bot, botInfo, keyboard);

    // Инициализируем handlers
    this.menuCommandsHandler = new MenuCommandsHandler(this.bot, this.keyboard, this.userService);
    this.callbackQueryHandler = new CallbackQueryHandler(this.bot, this.keyboard);
    this.apiSettingsHandler = new ApiSettingsHandler(this.bot, this.keyboard);
    this.slashCommandsHandler = new SlashCommandsHandler(this.bot, this.keyboard, this.userService);
    this.fileUploadHandler = new FileUploadHandler(this.bot, this.botInfo.token);
  }

  public boot() {
    this.slashCommandsHandler.setupBotCommands();

    // Настраиваем обработчики в правильном порядке
    this.onStart();
    this.menuCommandsHandler.setupHandlers(); // Команды меню первыми
    this.slashCommandsHandler.setupHandlers(); // Слеш команды
    this.fileUploadHandler.init(); // Обработка файлов
    this.callbackQueryHandler.setupHandlers(); // Inline кнопки
    this.apiSettingsHandler.setupHandlers(); // Обработка текста (API настройки) последним

    this.onStop();
    this.onFinish();
    console.log(`${this.instanceName} booted successfully.`);
  }

  public onStart() {
    this.bot.start(async (ctx) => {
      const userSubscription = await this.userService.handleUser(ctx.from);

      if (!userSubscription) {
        console.error('User not found or could not be created.');
        ctx.reply(
          'Ошибка при получении пользователя. Пожалуйста, попробуйте позже.',
        );
        return;
      }

      if (!userSubscription.isActive()) {
        // @todo научититься открывать чат с Vitality45
        const keyboard = await this.keyboard.createKeyboard([
          ['Написать @Vitality45'],
        ]);
        ctx.reply(
          'Подписка закончилась. Пожалуйста, свяжитесь с @Vitality45 для оплаты',
          keyboard,
        );
        return;
      }

      const yandexStore =
        await this.userService.handleUserYandexStore(userSubscription);

      if (!yandexStore) {
        ctx.reply(
          'Ошибка при получении вашего магазина Яндекс Маркета. Пожалуйста, попробуйте позже.',
        );
        return;
      }

      const welcomeMessage = `
      🎉 Добро пожаловать в бот для изменения цен в Яндекс Маркете!

      ✅ У вас есть активная подписка
      🎯 Вы можете использовать все функции бота

      Выберите действие из меню ниже:`;

      const keyboard = await this.keyboard.createMenuKeyboard();
      ctx.reply(welcomeMessage, keyboard);
    });
  }
}
