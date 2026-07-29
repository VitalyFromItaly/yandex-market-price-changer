import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MENU,
  MENU_LABELS,
  MENU_LAYOUT,
  menuLayout,
} from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';

const HANDLERS = join(process.cwd(), 'src/modules/telegram/bots/price-changer-bot');

const read = (rel: string) => readFileSync(join(HANDLERS, rel), 'utf8');

/**
 * Блокер B2: подписи меню лежали в четырёх независимых копиях, разъехались,
 * пересечение между клавиатурой и bot.hears стало пустым — и все кнопки молча
 * перестали работать. Ни компилятор, ни ревью этого не ловят, поэтому
 * инвариант «источник один» закреплён тестом.
 */
describe('меню: единственный источник подписей', () => {
  it('раскладка состоит только из известных подписей', () => {
    for (const row of MENU_LAYOUT) {
      for (const label of row) {
        expect(MENU_LABELS).toContain(label);
      }
    }
  });

  it('в раскладке нет пустых подписей', () => {
    // Раньше createStartKeyboard добавляла строку [''] — Telegram отвергает
    // такую кнопку как некорректную.
    for (const row of menuLayout()) {
      expect(row.length).toBeGreaterThan(0);
      for (const label of row) {
        expect(label.trim()).not.toBe('');
      }
    }
  });

  it('подписи уникальны — иначе два hears конфликтуют за один текст', () => {
    expect(new Set(MENU_LABELS).size).toBe(MENU_LABELS.length);
  });

  it('menuLayout() отдаёт мутабельную копию, не ломая константу', () => {
    // Конкретная метка тут не важна — важно, что порча копии не задевает
    // константу. Раньше здесь стояла MENU.SETTINGS, и тест краснел при любой
    // перестановке рядов, хотя проверяет он совсем другое.
    const original = menuLayout()[0][0];
    const copy = menuLayout();
    copy[0][0] = 'испорчено';

    expect(menuLayout()[0][0]).toBe(original);
    expect(menuLayout()[0][0]).not.toBe('испорчено');
  });

  it('на каждую подпись из справочника есть bot.hears', () => {
    const src = read('handlers/menu-commands.handler.ts');
    for (const key of Object.keys(MENU) as Array<keyof typeof MENU>) {
      expect(src).toContain(`bot.hears(MENU.${key}`);
    }
  });

  it('потребители берут подписи из menu.constants, а не хардкодят', () => {
    // Клавиатура и ветка main_menu — через menuLayout()
    expect(read('price-changer.keyboard.ts')).toContain('menuLayout()');
    expect(read('handlers/callback-query.handler.ts')).toContain('menuLayout()');
    // Фильтр «это кнопка меню?» — через MENU_LABELS
    expect(read('handlers/api-settings.handler.ts')).toContain('MENU_LABELS');
  });

  it('ни один потребитель не содержит reply-клавиатуры с литеральными подписями', () => {
    // Ищем массив-раскладку вида ['⚙️ ...'] в файлах, которые строят клавиатуру.
    for (const file of ['price-changer.keyboard.ts', 'handlers/callback-query.handler.ts']) {
      const src = read(file);
      for (const label of MENU_LABELS) {
        expect(src.includes(`'${label}'`)).toBe(false);
      }
    }
  });
});
