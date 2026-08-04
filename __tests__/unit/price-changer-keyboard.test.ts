import { describe, it, expect } from 'vitest';

import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';
import { PriceChangerKeyboard } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.keyboard';
import { FEATURE, type TFeatureMap } from '../../src/modules/telegram/bots/shared/features.domain';

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

  const labels = async (
    configured: boolean,
    isAdmin: boolean,
    showSwitchStore = false,
  ): Promise<string[]> => {
    const kb = await keyboard.buildMainKeyboard(configured, isAdmin, undefined, showSwitchStore);
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

  it('«Сменить магазин» появляется в меню только при флаге (>1 магазина)', async () => {
    // Флаг считает хендлер из кэша stores; клавиатура лишь показывает кнопку.
    expect(await labels(true, false, false)).not.toContain(MENU.SWITCH_STORE);
    expect(await labels(true, false, true)).toContain(MENU.SWITCH_STORE);
  });

  it('без магазина «Сменить магазин» не показываем, даже если флаг взведён', async () => {
    // Несконфигуренному — сокращённое меню; переключать нечего.
    expect(await labels(false, false, true)).not.toContain(MENU.SWITCH_STORE);
  });

  it('администратор с магазином — и отчёты, и «Пользователи»', async () => {
    const buttons = await labels(true, true);
    expect(buttons).toContain(MENU.PROFIT);
    expect(buttons).toContain(MENU.USERS);
  });
});

/**
 * FBY-only кнопки: «🏬 Склады» и «📦 FBY» живут только у FBY-магазина, поверх
 * своей фичи. Обычному продавцу нужны оба условия; администратору — только
 * магазин: гейт его и так пропускает, а записи флагов у него нет вовсе, и без
 * обхода фичевого фильтра он никогда не увидел бы кнопку, которую бот ему
 * разрешает.
 */
describe('FBY-only кнопки в главном меню', () => {
  const keyboard = new PriceChangerKeyboard();
  const FBY_ENABLED: TFeatureMap = { [FEATURE.WAREHOUSES]: true, [FEATURE.FBY]: true };

  const labels = async (
    isAdmin: boolean,
    features?: TFeatureMap,
    placementType?: string,
  ): Promise<string[]> => {
    const kb = await keyboard.buildMainKeyboard(true, isAdmin, features, false, placementType);
    return (kb.reply_markup.keyboard as string[][]).flat();
  };

  it('продавцу — только при включённой фиче И FBY-магазине', async () => {
    expect(await labels(false, FBY_ENABLED, 'FBY')).toContain(MENU.WAREHOUSES);
    expect(await labels(false, FBY_ENABLED, 'FBY')).toContain(MENU.FBY);
    // Фича есть, магазин FBS — кнопок нет.
    expect(await labels(false, FBY_ENABLED, 'FBS')).not.toContain(MENU.FBY);
    // Магазин FBY, фичи по умолчанию выключены — кнопок нет.
    expect(await labels(false, undefined, 'FBY')).not.toContain(MENU.FBY);
    // Модель неизвестна — кнопок нет (кэш доберётся фоном, кнопка догонит).
    expect(await labels(false, FBY_ENABLED)).not.toContain(MENU.FBY);
  });

  it('администратору — по одному условию: FBY-магазин', async () => {
    const onFby = await labels(true, undefined, 'FBY');
    expect(onFby).toContain(MENU.WAREHOUSES);
    expect(onFby).toContain(MENU.FBY);
    // Модель магазина обходом не является: FBY-экраны без FBY-магазина пусты
    // у кого угодно.
    expect(await labels(true, undefined, 'FBS')).not.toContain(MENU.FBY);
  });

  it('обход фич админом не воскрешает кнопку, закрытую самому админу явно', async () => {
    // Явных записей у админа не бывает (нет UserAccess), но даже переданная
    // карта игнорируется — раскладка обязана совпадать с гейтом, который флаги
    // админа не читает.
    const closed: TFeatureMap = { [FEATURE.FBY]: false };
    expect(await labels(true, closed, 'FBY')).toContain(MENU.FBY);
  });
});

/**
 * ГДЕ именно стоит «🏪 Сменить магазин».
 *
 * Проверяется не эстетика, а находимость: кнопка отдельным рядом в конце
 * уходила за нижнюю границу клавиатуры Telegram, и продавец её не видел —
 * приходил с «я не вижу кнопки хоть убей». Поэтому её место — верхний ряд,
 * рядом с «Прибылью», и это свойство должно быть зафиксировано.
 */
describe('Место кнопки «Сменить магазин» в раскладке', () => {
  const keyboard = new PriceChangerKeyboard();

  const rows = async (features?: TFeatureMap, showSwitchStore = true): Promise<string[][]> => {
    const kb = await keyboard.buildMainKeyboard(true, false, features, showSwitchStore);
    return kb.reply_markup.keyboard as string[][];
  };

  it('стоит в одном ряду с «Прибылью», и это ПЕРВЫЙ ряд', async () => {
    const layout = await rows();
    expect(layout[0]).toEqual([MENU.PROFIT, MENU.SWITCH_STORE]);
  });

  it('«Прибыль» ведёт меню и без кнопки смены', async () => {
    const layout = await rows(undefined, false);
    expect(layout[0]).toEqual([MENU.PROFIT]);
  });

  it('«Прибыль» закрыта админом — кнопка всё равно первым рядом, а не последним', async () => {
    // Дописать её в конец значило бы вернуть ту же ненаходимость, только
    // другому продавцу.
    const layout = await rows({ [FEATURE.REPORT_PROFIT]: false });
    expect(layout[0]).toEqual([MENU.SWITCH_STORE]);
    expect(layout.flat()).not.toContain(MENU.PROFIT);
  });

  it('ряд «Пользователи» у администратора остаётся последним', async () => {
    const kb = await keyboard.buildMainKeyboard(true, true, undefined, true);
    const layout = kb.reply_markup.keyboard as string[][];
    expect(layout.at(-1)).toEqual([MENU.USERS]);
    expect(layout[0]).toEqual([MENU.PROFIT, MENU.SWITCH_STORE]);
  });

  it('ни один ряд не пустой и подписи не дублируются', async () => {
    const layout = await rows();
    expect(layout.every((row) => row.length > 0)).toBe(true);
    const flat = layout.flat();
    expect(new Set(flat).size).toBe(flat.length);
  });
});
