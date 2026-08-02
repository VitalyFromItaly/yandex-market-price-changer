import { describe, it, expect } from 'vitest';

import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';
import { PriceChangerKeyboard } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.keyboard';

/**
 * Главное меню обязано зависеть от подключённого магазина.
 *
 * Без магазина кнопки отчётов ведут в тупик «сначала подключите магазин», и
 * показывать их незачем — в том числе администратору, который магазин не
 * подключил (гейт он минует, но магазин — нет). Это тот дефект, ради которого
 * появился `buildMainKeyboard`: раньше «Главное меню»/менюшные входы всегда
 * слали полное меню, игнорируя магазин.
 *
 * Метод чистый (без БД), поэтому проверяется прямым `new`, без Nest.
 */
describe('PriceChangerKeyboard.buildMainKeyboard', () => {
  const keyboard = new PriceChangerKeyboard();

  const labels = async (configured: boolean, isAdmin: boolean): Promise<string[]> => {
    const kb = await keyboard.buildMainKeyboard(configured, isAdmin);
    return (kb.reply_markup.keyboard as string[][]).flat();
  };

  it('с магазином — полное меню с кнопками отчётов', async () => {
    const buttons = await labels(true, false);
    expect(buttons).toContain(MENU.SHIPPED_TODAY);
    expect(buttons).toContain(MENU.PROFIT);
    expect(buttons).toContain(MENU.SETTINGS);
  });

  it('без магазина — только настройки и помощь, без кнопок отчётов', async () => {
    const buttons = await labels(false, false);
    expect(buttons).toContain(MENU.SETTINGS);
    expect(buttons).toContain(MENU.HELP);
    expect(buttons).not.toContain(MENU.PROFIT);
    expect(buttons).not.toContain(MENU.SHIPPED_TODAY);
    // Не-админ ряда «Пользователи» не получает.
    expect(buttons).not.toContain(MENU.USERS);
  });

  it('администратор без магазина сохраняет кнопку «Пользователи», но не отчёты', async () => {
    const buttons = await labels(false, true);
    expect(buttons).toContain(MENU.USERS);
    expect(buttons).toContain(MENU.SETTINGS);
    expect(buttons).not.toContain(MENU.PROFIT);
  });

  it('администратор с магазином — и отчёты, и «Пользователи»', async () => {
    const buttons = await labels(true, true);
    expect(buttons).toContain(MENU.PROFIT);
    expect(buttons).toContain(MENU.USERS);
  });
});
