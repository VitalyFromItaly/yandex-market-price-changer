import { ITelegramBotService, ITelegramKeyboard, TTelegrafBot } from '../../domain.telegram';
import { Context } from 'telegraf';

export default class BaseService<NotifyData> implements ITelegramBotService {
  protected bot: TTelegrafBot;
  protected keyboard: ITelegramKeyboard;

  constructor(bot: TTelegrafBot, keyboard: ITelegramKeyboard) {
    this.bot = bot;
    this.keyboard = keyboard;
  }

  //    bot.telegram.sendMessage(ctx.from.id, helpMessage, {
  //         parse_mode: 'Markdown'
  //     })
  public async sendMessage(chatId: number, text: string) {
    await this.bot.telegram.sendMessage(chatId, text);
  }

  public async notifySubscribers(payload: NotifyData) {
    throw new Error('Method not implemented.');
  }

  public async returnToMainMenu(context: Context) {
    // @ts-ignore
    context.scene?.leave();
    const keyboard = await this.keyboard.createStartKeyboard(context);
    await context.reply('Возвращаюсь в главное меню...', keyboard);
  }
}
