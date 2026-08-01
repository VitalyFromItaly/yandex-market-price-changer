import type { TFeatureMap } from '../shared/features.domain';

import { Injectable } from '@nestjs/common';
import { Markup } from 'telegraf';

import { TelegramKeyboard } from '../../ui/keyboard.ui.telegram';
import { featureMenuLayout } from '../shared/features.domain';

import { unconfiguredMenuLayout, withAdminRow } from './menu.constants';

@Injectable()
export class PriceChangerKeyboard extends TelegramKeyboard {
  /** Сокращённое меню: только настройки и помощь, пока креды не заполнены. */
  public async createUnconfiguredKeyboard(isAdmin = false): Promise<Markup.Markup<any>> {
    const layout = unconfiguredMenuLayout();
    return await this.createKeyboard(isAdmin ? withAdminRow(layout) : layout);
  }

  /**
   * Меню с рядом администратора и без кнопок закрытых возможностей.
   *
   * `features` необязателен: там, где записи доступа под рукой нет, раскладка
   * собирается по умолчанию из реестра. Полагаться на одну лишь раскладку
   * нельзя — подпись кнопки можно прислать текстом, а старая inline-кнопка
   * живёт в истории чата вечно; за это отвечает FeatureGateHandler.
   */
  public async createMenuKeyboard(
    isAdmin = false,
    features?: TFeatureMap,
  ): Promise<Markup.Markup<any>> {
    // Подписи берутся из menu.constants — единственного источника (TASK-014).
    const layout = featureMenuLayout(features);
    return await this.createKeyboard(isAdmin ? withAdminRow(layout) : layout);
  }

  public async createStartKeyboard(commands: string[][] = []): Promise<Markup.Markup<any>> {
    // Раньше здесь добавлялись строка «Установить коэффициент цены» и строка
    // с ПУСТОЙ подписью [''] — последнюю Telegram отвергает как некорректную
    // кнопку. Убраны обе.
    return await this.createKeyboard(commands);
  }
}
