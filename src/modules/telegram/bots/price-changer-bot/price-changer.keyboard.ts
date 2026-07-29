import { Injectable } from '@nestjs/common';
import { Markup } from 'telegraf';

import { TelegramKeyboard } from '../../ui/keyboard.ui.telegram';

import { menuLayout, unconfiguredMenuLayout } from './menu.constants';

@Injectable()
export class PriceChangerKeyboard extends TelegramKeyboard {
  /** Сокращённое меню: только настройки и помощь, пока креды не заполнены. */
  public async createUnconfiguredKeyboard(): Promise<Markup.Markup<any>> {
    return await this.createKeyboard(unconfiguredMenuLayout());
  }

  public async createMenuKeyboard(): Promise<Markup.Markup<any>> {
    // Подписи берутся из menu.constants — единственного источника (TASK-014).
    return await this.createKeyboard(menuLayout());
  }

  public async createStartKeyboard(commands: string[][] = []): Promise<Markup.Markup<any>> {
    // Раньше здесь добавлялись строка «Установить коэффициент цены» и строка
    // с ПУСТОЙ подписью [''] — последнюю Telegram отвергает как некорректную
    // кнопку. Убраны обе.
    return await this.createKeyboard(commands);
  }
}
