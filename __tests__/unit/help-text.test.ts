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
    expect(text).not.toContain('ничего не меняет');

    // «только на чтение» в справке теперь ВСТРЕЧАЕТСЯ — но как предупреждение
    // не выбирать такой доступ при выпуске токена, а не как обещание бота.
    // Проверяем именно смысл: рядом обязана стоять причина запрета.
    if (text.includes('только на чтение')) {
      expect(text).toContain('не сможет обновлять');
    }
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

  it('обещает, что кроме токена искать в кабинете нечего', () => {
    // Иначе пользователь пойдёт искать идентификаторы, как требовал старый текст.
    expect(text).toContain('только API-токен');
    expect(text).toMatch(/ничего искать|определит сам|автоматическ/);
    // Но САМИ идентификаторы не называем: узнав из этой строки об их
    // существовании, человек всё равно пойдёт их искать.
    expect(text).not.toContain('Campaign ID');
    expect(text).not.toContain('Business ID');
  });

  it('объясняет, как получить API-токен', () => {
    // Инструкция нужна именно здесь: до подключения магазина «Помощь» —
    // одна из двух кнопок, доступных пользователю.
    expect(text).toContain('partner.market.yandex.ru');
    expect(text).toContain('Обработка заказов и учёт товаров');
  });

  it('не предлагает устаревший формат ввода всех значений разом', () => {
    expect(text).not.toContain('Campaign ID: ваш_id');
  });
});
