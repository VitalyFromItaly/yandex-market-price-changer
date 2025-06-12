import { EBotType, ITelegramBot, TFindBotPayload } from '../domain.telegram';
import { TNotifySubscribersData } from './pump-and-dump/pump-and-dump.domain';
import { TLiquidationData } from './liquidation/liquidation.domain';

export default class BotFather {
  public bots: Map<EBotType, Map<string, ITelegramBot>>; // Map<type, Map<id, ITelegramBot>>

  constructor() {
    this.bots = new Map();
  }

  public async boot() {
    // to be defined
    throw new Error(`method to be defined`);
    // const bots = await BotsModel.find();
    // if (!bots.length) {
    //   const bot = await BotsModel.create({
    // define a bot
    //   });
    //   bots.push(bot);
    // }
    //
    // for (const bot of bots) {
    //   if (!this.bots.has(bot.type)) {
    //     this.bots.set(bot.type, new Map());
    //   }
    //
    //   const botsByType = this.bots.get(bot.type);
    //   const Bot = this.getBotInstanceByType(bot.type);
    //   const botInstance = new Bot(new Telegraf(bot.token), bot);
    //
    //   botsByType.set(bot.id, botInstance);
    // }
    //
    // this.launchBots();
  }

  private getBotInstanceByType(_type: EBotType) {
    // create a bot instance by type
    throw new Error(`method to be defined`);
  }

  public launchBots() {
    console.log(`Launching ${this.bots.size} telegram bots...`);

    this.bots.forEach((botsByType) => {
      botsByType.forEach((bot) => {
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
