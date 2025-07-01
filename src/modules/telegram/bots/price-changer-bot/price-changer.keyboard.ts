import { TelegramKeyboard } from '../../ui/keyboard.ui.telegram';
import { Markup } from 'telegraf';

export class PriceChangerKeyboard extends TelegramKeyboard {
  private menuCommands = [
    ['⚙️ Настройки'],
    ['💰 Установить коэффициент цены'],
    ['📄 Загрузить прайс-лист'],
    ['❓ Помощь', '👤 Профиль'],
  ];

  public async createMenuKeyboard(): Promise<Markup.Markup<any>> {
    return await this.createKeyboard(this.menuCommands);
  }

  public async createStartKeyboard(commands: string[][] = []): Promise<Markup.Markup<any>> {
    commands.push(
      ['Установить коэффициент цены'],
      ['']
    );

    return await this.createKeyboard(commands);
  }
}
