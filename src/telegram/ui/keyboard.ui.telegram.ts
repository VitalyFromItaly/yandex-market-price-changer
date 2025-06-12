import { Markup } from 'telegraf';
import { ITelegramKeyboard } from '../domain.telegram';
import { KeyboardBuilder } from '../bots/shared/KeyboardBuilder';

export class TelegramKeyboard implements ITelegramKeyboard {
   public builder = new KeyboardBuilder();

  public async createInlineButton(text: string, callback_data: string) {
    return Markup.inlineKeyboard([Markup.button.callback(text, callback_data)]);
  }

  public async createInlineButtons(buttons: { text: string; callback_data: string }[]): Promise<Markup.Markup<any>> {
    return Markup.inlineKeyboard(
      buttons.map((button) => Markup.button.callback(button.text, button.callback_data))
    );
  }

  public async createKeyboard(keyboard: string[][]) {
    return Markup.keyboard(keyboard).resize();
  }

  createStartKeyboard() {
    return Promise.resolve(undefined);
  }
}
