import { Markup } from 'telegraf';

export class KeyboardBuilder {
  private keyboardCommands = new Set<string[]>();
  private keyboardInlineButtons: { text: string; callback_data: string }[] = [];

  public addCommand(...commands: string[]) {
    this.keyboardCommands.add(commands);
    return this;
  }

  public addInlineButton(text: string, callback_data: string) {
    this.keyboardInlineButtons.push({ text, callback_data });
    return this;
  }

  public async build() {
    const keyboard = Markup.keyboard(Array.from(this.keyboardCommands)).resize();
    this.keyboardCommands.clear();

    return keyboard;
  }

  public async buildInline() {
    return Markup.inlineKeyboard(
      this.keyboardInlineButtons.map((button) => Markup.button.callback(button.text, button.callback_data))
    );
  }
}
