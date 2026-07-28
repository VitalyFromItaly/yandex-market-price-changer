import {
  ITelegramBot,
  ITelegramKeyboard,
  THandleUpdatePayload,
  TTelegrafBot,
  TWebHookResponse,
} from '../../domain.telegram';
import { IBotSchema } from '../../../../database/schemas';
import TryCatch from '../../../../shared/decorators/TryCatch';
import DecorateMethodsWith from '../../../../shared/decorators/DecorateWith';
import { Telegraf } from 'telegraf';
import { TelegramUserService } from './services/telegram-user.service';
import { SubscriptionService } from '../../../../database/services';
import { YandexMarketService } from '../../../../database/services';

@DecorateMethodsWith(TryCatch())
export default class BaseTelegramBot implements ITelegramBot {
  protected bot: TTelegrafBot;
  protected botInfo: IBotSchema & { _id: string };
  protected userService: TelegramUserService;
  protected keyboard: ITelegramKeyboard;

  constructor(
    bot: TTelegrafBot,
    botInfo: IBotSchema & { _id: string },
    keyboard: ITelegramKeyboard,
    subscriptionService: SubscriptionService,
    yandexMarketService: YandexMarketService
  ) {
    this.bot = bot;
    this.botInfo = botInfo;
    this.userService = new TelegramUserService(bot, subscriptionService, yandexMarketService);
    this.keyboard = keyboard;
  }

  protected get instanceName(): string {
    return this.constructor.name;
  }

  public get id(): string {
    return this.botInfo._id;
  }

  private get type() {
    return this.botInfo.type;
  }

  private get name() {
    return this.botInfo.name;
  }

  protected onStart(message = 'Нажми кнопку "Показать команды" (справа), чтобы увидеть список команд.') {
    this.bot.start((ctx) => {
      ctx.reply(message);
    });
  }

  protected onStop() {
    this.bot.command('stop', (ctx) => {
      ctx.reply('Останавливаю бота...');
      this.bot.stop(); // Остановка бота
    });
  }

  protected onFinish() {
    this.bot.on('message', (ctx) => {
      ctx.reply('Неизвестная команда');
    });
  }

  public boot(): void {
    throw new Error('Method not implemented.');
  }

  public async handleUpdate(payload: THandleUpdatePayload, webhookResponse?: TWebHookResponse) {
    await this.bot.handleUpdate(payload, webhookResponse);
  }

  public async launch(): Promise<void> {
    const onLaunch = () => {
      console.log(`${this.botInfo.type} Bot 🤖 ${this.botInfo.name.toUpperCase()} has launched 🚀`);
    };

    const payload: Telegraf.LaunchOptions = {
      webhook: {
        domain: process.env.TELEGRAM_PROXY_URL,
        hookPath: `/api/telegram/webhooks/${this.type}/${this.id}`
      }
    };

    await this.bot.launch(payload, onLaunch);
  }
}
