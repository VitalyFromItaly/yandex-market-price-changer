import { describe, it, expect } from 'vitest';

import { helpText } from '../../src/modules/telegram/bots/price-changer-bot/help.text';
import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';

/**
 * Справка — единственный текст, который пользователь читает, чтобы понять,
 * что бот умеет. Обещание, которому код не соответствует, хуже отсутствия
 * документации: по нему принимают решения.
 */
describe('Справка', () => {
  const text = helpText();

  it('НЕ утверждает «только на чтение» — бот обновляет остатки', () => {
    // Прежний текст это обещал. После TASK-035 обещание перестало быть верным.
    expect(text).not.toContain('только на чтение');
    expect(text).not.toContain('ничего не меняет');
  });

  it('перечисляет все четыре отчёта подписями из menu.constants', () => {
    for (const label of [MENU.SHIPPED_TODAY, MENU.REDEEMED, MENU.RETURNING, MENU.IN_TRANSIT]) {
      expect(text).toContain(label);
    }
  });

  it('рассказывает про рассылку и обновление остатков', () => {
    expect(text).toContain(MENU.SCHEDULE);
    expect(text).toContain('остатк');
    expect(text).toContain('проверка'); // режим сухого прогона
  });

  it('говорит, что ID определяются автоматически', () => {
    // Иначе пользователь пойдёт искать их в кабинете, как требовал старый текст.
    expect(text).toMatch(/определит сам|автоматическ/);
  });

  it('не предлагает устаревший формат ввода всех значений разом', () => {
    expect(text).not.toContain('Campaign ID: ваш_id');
  });
});
