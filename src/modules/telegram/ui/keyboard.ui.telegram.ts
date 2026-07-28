import { Markup } from 'telegraf';
import { Injectable } from '@nestjs/common';
import { ITelegramKeyboard, TTelegramKeyboard } from '../domain.telegram';
import { KeyboardBuilder } from '../bots/shared/KeyboardBuilder';
import { Promise } from 'mongoose';
import { keyboard } from 'telegraf/markup';

@Injectable()
export class TelegramKeyboard implements ITelegramKeyboard {
  public protected = new KeyboardBuilder();

  // === INLINE КЛАВИАТУРЫ (кнопки прикрепленные к сообщению) ===

  createMenuKeyboard(): Promise<TTelegramKeyboard> {
    return Promise.resolve(undefined);
  }

  /**
   * Создать одну inline кнопку
   */
  public async createInlineButton(text: string, callback_data: string) {
    return Markup.inlineKeyboard([Markup.button.callback(text, callback_data)]);
  }

  /**
   * Создать несколько inline кнопок в ряд
   */
  public async createInlineButtons(buttons: { text: string; callback_data: string }[]): Promise<Markup.Markup<any>> {
    return Markup.inlineKeyboard(
      buttons.map((button) => Markup.button.callback(button.text, button.callback_data))
    );
  }

  /**
   * Создать inline клавиатуру с кнопками в несколько рядов
   */
  public async createInlineKeyboardMatrix(buttons: { text: string; callback_data: string }[][]) {
    return Markup.inlineKeyboard(
      buttons.map(row =>
        row.map(button => Markup.button.callback(button.text, button.callback_data))
      )
    );
  }

  /**
   * Создать inline кнопку с URL
   */
  public async createUrlButton(text: string, url: string) {
    return Markup.inlineKeyboard([Markup.button.url(text, url)]);
  }

  // === REPLY КЛАВИАТУРЫ (обычные кнопки внизу экрана) ===

  /**
   * Создать обычную клавиатуру
   */
  public async createKeyboard(keyboard: string[][]) {
    return Markup.keyboard(keyboard).resize();
  }

  /**
   * Создать клавиатуру с одноразовыми кнопками (исчезают после нажатия)
   */
  public async createOneTimeKeyboard(keyboard: string[][]) {
    return Markup.keyboard(keyboard).oneTime().resize();
  }

  /**
   * Убрать клавиатуру
   */
  public removeKeyboard() {
    return Markup.removeKeyboard();
  }

  // === СПЕЦИАЛЬНЫЕ КЛАВИАТУРЫ ===

  /**
   * Создать клавиатуру с кнопкой "Поделиться контактом"
   */
  public async createContactKeyboard(text: string = 'Поделиться контактом') {
    return Markup.keyboard([
      [Markup.button.contactRequest(text)]
    ]).resize();
  }

  /**
   * Создать клавиатуру с кнопкой "Поделиться местоположением"
   */
  public async createLocationKeyboard(text: string = 'Поделиться местоположением') {
    return Markup.keyboard([
      [Markup.button.locationRequest(text)]
    ]).resize();
  }

  // === ГОТОВЫЕ ШАБЛОНЫ ===

  /**
   * @deprecated НЕ ВЫЗЫВАТЬ. Строит reply-клавиатуру с ЖЁСТКО ЗАШИТЫМИ
   * подписями, которых нет ни в menu.constants, ни в bot.hears. Вызов этого
   * метода воспроизведёт блокер B2 один в один: кнопки отрисуются, но ни одна
   * не сработает — нажатие уйдёт в catch-all и будет погашено без ответа.
   *
   * Reply-кнопки маршрутизируются ПО ТЕКСТУ, поэтому их подписи обязаны
   * приходить из menu.constants. Используйте PriceChangerKeyboard.createMenuKeyboard().
   * (Inline-кнопок это не касается — они маршрутизируются по callback_data.)
   */
  public async createMainMenu() {
    return Markup.keyboard([
      ['📊 Статистика', '⚙️ Настройки'],
      ['💰 Установить коэффициент цены'],
      ['📄 Загрузить прайс-лист'],
      ['❓ Помощь', '👤 Профиль']
    ]).resize();
  }

  /**
   * Меню подтверждения
   */
  public async createConfirmationMenu() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Да', 'confirm_yes'),
        Markup.button.callback('❌ Нет', 'confirm_no')
      ]
    ]);
  }

  /**
   * @deprecated НЕ ВЫЗЫВАТЬ — та же проблема, что у createMainMenu:
   * reply-клавиатура с подписями вне menu.constants. Обработчика на
   * «⬅️ Назад» не существует.
   */
  public async createBackMenu() {
    return Markup.keyboard([
      ['⬅️ Назад', '🏠 Главное меню']
    ]).resize();
  }

  /**
   * Стартовая клавиатура (переопределяем базовый метод)
   */
  public async createStartKeyboard() {
    return this.createMainMenu();
  }
}
