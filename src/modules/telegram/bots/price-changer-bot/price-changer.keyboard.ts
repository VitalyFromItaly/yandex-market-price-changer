import { TelegramKeyboard } from '../../ui/keyboard.ui.telegram';
import { Markup } from 'telegraf';

export class PriceChangerKeyboard extends TelegramKeyboard {
  // Убраны кнопки «Установить коэффициент цены» и «Загрузить прайс-лист»
  // (TASK-009): изменение цен по API отключено.
  //
  // ВАЖНО: подписи здесь и в bot.hears сейчас задаются в двух разных местах и
  // уже разъезжались — из-за этого все кнопки меню молча не работали. Свести их
  // в единый источник истины — TASK-014.
  private menuCommands = [
    ['⚙️ Настройки API'],
    ['❓ Помощь', '📊 Мой профиль'],
  ];

  public async createMenuKeyboard(): Promise<Markup.Markup<any>> {
    return await this.createKeyboard(this.menuCommands);
  }

  public async createStartKeyboard(commands: string[][] = []): Promise<Markup.Markup<any>> {
    // Раньше здесь добавлялись строка «Установить коэффициент цены» и строка
    // с ПУСТОЙ подписью [''] — последнюю Telegram отвергает как некорректную
    // кнопку. Убраны обе.
    return await this.createKeyboard(commands);
  }
}
