import { EBotType, ITelegramBot, TFindBotPayload } from '../domain.telegram';
import { Telegraf } from 'telegraf';
import PriceChangerBot from './price-changer-bot/price-changer.bot';
import { Model } from 'mongoose';
import { Bot, BotDocument, IBotSchema } from '../../../database/schemas/bot.schema';
import { SubscriptionService } from '../../../database/services/subscription.service';
import { YandexMarketService } from '../../../database/services/yandex-market.service';
import { FileProcessingService } from '../queue/services/file-processing.service';

export default class BotFather {
  public bots: Map<string, Map<string, ITelegramBot>>; // Map<type, Map<id, ITelegramBot>>

  constructor(
    private botModel: Model<BotDocument>,
    private subscriptionService: SubscriptionService,
    private yandexMarketService: YandexMarketService,
    private fileProcessingService: FileProcessingService,
  ) {
    this.bots = new Map<string, Map<string, ITelegramBot>>();
  }

  public async boot() {
    const bots = await this.botModel.find();
    if (!bots.length) {
      const bot = await this.botModel.create({
        type: EBotType.PRICE_CHANGER_BOT,
        token: process.env.TELEGRAM_TOKEN,
        name: 'Artem bot for changing prices in yandex market',
        description: 'this is a bot for changing prices',
      });
      bots.push(bot);
    }

    for (const bot of bots) {
      const botType = bot.type as EBotType;
      if (!this.bots.has(botType)) {
        this.bots.set(botType, new Map());
      }

      const botsByType = this.bots.get(botType);
      const Bot = this.getBotInstanceByType(botType);

      // Создаем объект с правильными типами
      const botInfo: IBotSchema & { _id: string } = {
        _id: bot._id.toString(),
        name: bot.name,
        token: bot.token,
        type: bot.type as EBotType,
        description: bot.description,
        status: bot.status,
        created_at: bot.created_at || new Date(),
        timezone: bot.timezone,
      };

      // Pass DI services to bot constructor
      const botInstance = new Bot(
        new Telegraf(bot.token),
        botInfo,
        this.subscriptionService,
        this.yandexMarketService,
        this.fileProcessingService
      );

      botsByType.set(bot.id, botInstance);
    }

    this.launchBots();
    console.log('Telegram bots initialized');
  }

  private getBotInstanceByType(type: EBotType) {
    if (type === EBotType.PRICE_CHANGER_BOT) {
      return PriceChangerBot;
    }

    return PriceChangerBot;
  }

  public launchBots() {
    console.log(`Launching ${this.bots.size} telegram bot${this.bots.size > 1 ? 's': ''}...`);

    this.bots.forEach((botsByType) => {
      botsByType.forEach((bot) => {
        console.log(`Launching bot: ${bot.id}`);
        bot.launch();
      });
    });
  }

  public findBot(payload: TFindBotPayload) {
    const botsByType = this.bots.get(payload.type);
    if (!botsByType) {
      return null;
    }

    return botsByType.get(payload.id) || null;
  }
}
