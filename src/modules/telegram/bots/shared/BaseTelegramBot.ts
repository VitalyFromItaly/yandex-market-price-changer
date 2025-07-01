import {
  EBotName,
  ITelegramBot,
  ITelegramKeyboard,
  THandleUpdatePayload,
  TTelegrafBot,
  TWebHookResponse,
} from '../../domain.telegram';
import { IBotSchema } from '../../../../database/mongo/models/bot.model.mongo';
import TryCatch from '../../../../shared/decorators/TryCatch';
import DecorateMethodsWith from '../../../../shared/decorators/DecorateWith';
import { Telegraf } from 'telegraf';
import { TelegramUserService } from './services/user-subscription.service';

@DecorateMethodsWith(TryCatch())
export default class BaseTelegramBot implements ITelegramBot {
  protected bot: TTelegrafBot;
  protected botInfo: IBotSchema;
  protected userService: TelegramUserService;
  protected keyboard: ITelegramKeyboard;

  constructor(bot: TTelegrafBot, botInfo: IBotSchema, keyboard: ITelegramKeyboard) {
    this.bot = bot;
    this.botInfo = botInfo;
    this.userService = new TelegramUserService(bot);
    this.keyboard = keyboard;
  }

  protected get instanceName(): string {
    return this.constructor.name;
  }

  public get id(): string {
    // @ts-ignore
    return this.botInfo._id.toString();
  }

  private get type() {
    return this.botInfo.type;
  }

  private get name() {
    return this.botInfo.name;
  }

  protected onStart(message = 'Нажми кнопку "Показать команды" (справа), чтобы увидеть список команд.') {
    // /start
    this.bot.start(async (ctx) => {
      const user = await this.userService.handleUser(ctx.from);
      console.log({ user });
      const keyboard = await this.keyboard.createStartKeyboard();
      ctx.reply(message, keyboard);
    });
  }

  protected onStop() {
    this.bot.command('stop', (ctx) => {
      ctx.reply('Останавливаю бота...');
      this.bot.stop(); // Остановка бота
    });
  }

  protected onFinish() {
    // Включите graceful stop
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
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
