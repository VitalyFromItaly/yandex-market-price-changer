import { EBotType, ITelegramBot, TFindBotPayload } from '../domain.telegram';
import { BotsModel } from '../../../database/mongo';
import { Telegraf } from 'telegraf';
import PriceChangerBot from './price-changer-bot/price-changer.bot';

export default class BotFather {
  public bots: Map<EBotType, Map<string, ITelegramBot>>; // Map<type, Map<id, ITelegramBot>>

  constructor() {
    this.bots = new Map();
  }

  public async boot() {
    const bots = await BotsModel.find();
    if (!bots.length) {
      const bot = await BotsModel.create({
        type: EBotType.PRICE_CHANGER_BOT,
        token: process.env.TELEGRAM_TOKEN,
        name: 'Artem bot for changing prices in yandex market',
        description: 'this is a bot for changing prices',
      });
      bots.push(bot);
    }

    for (const bot of bots) {
      if (!this.bots.has(bot.type)) {
        this.bots.set(bot.type, new Map());
      }

      const botsByType = this.bots.get(bot.type);
      const Bot = this.getBotInstanceByType(bot.type);
      const botInstance = new Bot(new Telegraf(bot.token), bot);

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
        bot.boot();
        bot.launch();
      });
    });
  }

  public findBot(payload: TFindBotPayload) {
    const { id, type } = payload;
    if (!this.bots.has(type as EBotType)) {
      return null;
    }

    const botsByType = this.bots.get(type as EBotType);
    const bot = botsByType.get(id);

    if (bot) {
      return bot;
    }

    return null;
  }
}
