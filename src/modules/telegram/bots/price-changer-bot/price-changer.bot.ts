import BaseTelegramBot from '../shared/BaseTelegramBot';
import { TTelegrafBot } from '../../domain.telegram';
import { IBotSchema } from '../../../../database/schemas/bot.schema';
import { PriceChangerKeyboard } from './price-changer.keyboard';
import { MenuCommandsHandler } from './handlers/menu-commands.handler';
import { CallbackQueryHandler } from './handlers/callback-query.handler';
import { ApiSettingsHandler } from './handlers/api-settings.handler';
import { SlashCommandsHandler } from './handlers/slash-commands.handler';
import { FileUploadHandler } from './handlers/file-upload.handler';
import { SubscriptionService } from '../../../../database/services/subscription.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ITelegramBot } from '../../domain.telegram';
import { FileProcessingService } from '../../queue/services/file-processing.service';
import { AppConfigService } from '../../../../config/app-config.service';

export default class PriceChangerBot extends BaseTelegramBot {
  private menuCommandsHandler: MenuCommandsHandler;
  private callbackQueryHandler: CallbackQueryHandler;
  private apiSettingsHandler: ApiSettingsHandler;
  private slashCommandsHandler: SlashCommandsHandler;
  private fileUploadHandler: FileUploadHandler;

  constructor(
    bot: TTelegrafBot,
    botInfo: IBotSchema & { _id: string },
    subscriptionService: SubscriptionService,
    yandexMarketService: YandexMarketService,
    fileProcessingService: FileProcessingService,
    config: AppConfigService,
    // Больше не нужен fileDataProcessorService
  ) {
    const keyboard = new PriceChangerKeyboard();
    super(bot, botInfo, keyboard, subscriptionService, yandexMarketService, config);

    // Инициализируем handlers с сервисами
    this.menuCommandsHandler = new MenuCommandsHandler(this.bot, this.keyboard, this.userService, yandexMarketService);
    this.callbackQueryHandler = new CallbackQueryHandler(this.bot, this.keyboard, yandexMarketService);
    this.apiSettingsHandler = new ApiSettingsHandler(this.bot, this.keyboard, yandexMarketService);
    this.slashCommandsHandler = new SlashCommandsHandler(this.bot, this.keyboard, this.userService, yandexMarketService);

    // Обновленный вызов конструктора
    this.fileUploadHandler = new FileUploadHandler(
      this.bot,
      this.botInfo.token,
      fileProcessingService,
    );
  }

  public boot() {
    this.slashCommandsHandler.setupBotCommands();

    // Настраиваем обработчики в правильном порядке
    this.onStart();
    this.menuCommandsHandler.setupHandlers(); // Команды меню первыми
    this.slashCommandsHandler.setupHandlers(); // Слеш команды
    // fileUploadHandler.init() снят (TASK-009): приём документа обслуживал
    // загрузку прайс-листа для отключённого изменения цен. Присланный файл
    // больше не скачивается и не ставится в очередь. Загрузка вернётся
    // отдельной задачей под ОСТАТКИ (TASK-035) и будет написана заново.
    this.callbackQueryHandler.setupHandlers(); // Inline кнопки
    this.apiSettingsHandler.setupHandlers(); // Обработка текста (API настройки) последним

    this.onStop();
    this.onFinish();
    console.log(`${this.instanceName} booted successfully.`);
  }

  public async launch(): Promise<void> {
    this.boot();
    await super.launch();
  }

  public onStart() {
    console.log('Starting... ', this.instanceName);
    this.bot.start(async (ctx) => {
      const userSubscription = await this.userService.handleUser(ctx.from);

      if (!userSubscription) {
        console.error('User not found or could not be created.');
        ctx.reply(
          'Ошибка при получении пользователя. Пожалуйста, попробуйте позже.',
        );
        return;
      }

      // Проверяем активность подписки через сервис
      const subscriptionCheck = await this.userService.checkUserSubscription(ctx.from);
      if (!subscriptionCheck.hasActiveSubscription) {
        // @todo научитиься открывать чат с Vitality45
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
