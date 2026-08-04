import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  settingsKeyboardRows,
  settingsText,
} from '../../src/modules/telegram/bots/price-changer-bot/settings.text';
import { DEFAULT_RATES, RATE_FIELDS, rateCallback } from '../../src/modules/yandex/reports/profit';
import { BRAND_CB_MENU } from '../../src/modules/yandex/reports/brands';
import { PROMO_CB_MENU } from '../../src/modules/yandex/reports/promo';
import { profileText } from '../../src/modules/telegram/bots/price-changer-bot/profile.text';
import { helpText } from '../../src/modules/telegram/bots/price-changer-bot/help.text';

/**
 * Один экран — один текст.
 *
 * Дефект повторялся трижды. Справка: у команды был свой текст, у кнопки —
 * заглушка в главное меню (закрыто TASK-051). Настройки: кнопка показывала
 * состояние магазина, а `/settings` — меню из двух inline-кнопок, причём
 * «🔄 Автообновление» не имела обработчика вовсе и отвечала «Неизвестная
 * команда: settings_auto_update». Профиль: кнопка печатала три поля,
 * `/profile` — шесть, с другой пунктуацией подписей.
 *
 * Пока копий две, они расходятся, и ни компилятор, ни ревью этого не ловят.
 * Тот же приём, что в menu-labels.test.ts: инвариант проверяется чтением
 * исходников как текста.
 */
describe('Экраны собираются из одного источника', () => {
  const BOT = resolve(__dirname, '../../src/modules/telegram/bots/price-changer-bot');

  /**
   * Комментарии отбрасываем — как в subscription-removed.test.ts. Снятые
   * сущности продолжают упоминаться в пояснениях «почему это убрали», и такие
   * записи ценны; проверять надо живой код.
   */
  const read = (file: string) =>
    readFileSync(join(BOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  const menuHandler = read('handlers/menu-commands.handler.ts');
  const slashHandler = read('handlers/slash-commands.handler.ts');
  const callbackHandler = read('handlers/callback-query.handler.ts');

  it('оба входа в настройки зовут settingsText', () => {
    expect(menuHandler).toContain('settingsText(');
    expect(slashHandler).toContain('settingsText(');
  });

  it('оба входа в профиль зовут profileText', () => {
    expect(menuHandler).toContain('profileText(');
    expect(slashHandler).toContain('profileText(');
  });

  it('кнопки «Автообновление» больше нет — у неё не было обработчика', () => {
    expect(slashHandler).not.toContain('settings_auto_update');
  });

  it('экран скидок по брендам рендерится только из brand-discounts.text', () => {
    // Экран показывается из трёх мест (кнопка настроек, после сохранения,
    // после отмены) — все через один showBrandDiscounts, который обязан звать
    // общий модуль, а не собирать текст на месте.
    const apiSettings = read('handlers/api-settings.handler.ts');
    expect(apiSettings).toContain('brandDiscountsText(');
    expect(apiSettings).toContain('brandDiscountsKeyboardRows(');
  });

  it('экран продвижения рендерится только из promotion.text', () => {
    // Тот же инвариант: показов несколько (кнопка настроек, после сохранения,
    // после отмены, после отключения) — все через showPromotion/
    // showPromotionMode, которые обязаны звать общий модуль.
    const apiSettings = read('handlers/api-settings.handler.ts');
    expect(apiSettings).toContain('promotionText(');
    expect(apiSettings).toContain('promotionKeyboardRows(');
    expect(apiSettings).toContain('promotionModeText(');
    expect(apiSettings).toContain('promotionModeKeyboardRows(');
  });

  it('главное меню подписано одинаково во всех входах', () => {
    // Было три подписи на один экран: «🏠 Главное меню», «🏠 Главное меню:»
    // и «📋 Главное меню:». Теперь все берут MENU.MAIN.
    for (const source of [menuHandler, slashHandler, callbackHandler]) {
      expect(source).not.toMatch(/'[^']*Главное меню:?'/);
    }
  });
});

describe('Идентификаторы магазина скрыты от продавца', () => {
  const STORE = {
    campaign_id: '12345678',
    business_id: '87654321',
    token: 'ACMA:secret:value',
    name: 'allbestwatch.ru',
  } as never;

  it('экран настроек показывает название, а не два числа', () => {
    const text = settingsText(STORE);

    expect(text).toContain('allbestwatch.ru');
    expect(text).not.toContain('12345678');
    expect(text).not.toContain('87654321');
  });

  it('экран настроек не НАЗЫВАЕТ Campaign ID и Business ID', () => {
    // Убрать числа, но оставить «Campaign ID и Business ID бот определит сам» —
    // полумера: продавец всё равно узнаёт из этой строки о полях, которые его
    // не касаются, и идёт искать их в кабинете. Проверяем оба состояния.
    for (const text of [settingsText(null), settingsText(STORE)]) {
      expect(text).not.toContain('Campaign ID');
      expect(text).not.toContain('Business ID');
    }
  });

  it('экран настроек не пересказывает строку состояния прозой', () => {
    // Было «🏪 Магазин: ❌ не подключён» и следом «Магазин не подключён.» —
    // одно и то же дважды подряд.
    const notConfigured = settingsText(null);
    expect(notConfigured.match(/не подключён/g)).toHaveLength(1);
  });

  it('справка тоже не называет идентификаторы', () => {
    expect(helpText()).not.toContain('Campaign ID');
    expect(helpText()).not.toContain('Business ID');
  });

  it('экран настроек не печатает токен', () => {
    // Секрет продавца не должен лежать в переписке даже частично-читаемым.
    expect(settingsText(STORE)).not.toContain('ACMA:secret:value');
  });

  it('профиль показывает магазин по названию', () => {
    const text = profileText({
      telegramUserId: 222,
      firstName: 'Вася',
      configured: true,
      storeName: 'allbestwatch.ru',
      accessStatus: 'approved',
    });

    expect(text).toContain('allbestwatch.ru');
    expect(text).not.toContain('12345678');
  });

  it('неподключённый магазин назван прямо, без «настройки не заполнены»', () => {
    const text = settingsText(null);
    expect(text).toContain('не подключён');
  });
});

describe('Ставки расчёта прибыли на экране настроек', () => {
  const STORE = {
    campaign_id: '12345678',
    business_id: '87654321',
    token: 'ACMA:secret:value',
    name: 'allbestwatch.ru',
  } as never;

  it('видны текущие проценты и формат правки', () => {
    const text = settingsText(STORE);

    expect(text).toContain('Комиссия Маркета');
    expect(text).toContain('23%');
    expect(text).toContain('Налог с продаж');
    expect(text).toContain('7%');
    expect(text).toContain('комиссия: 23');
    expect(text).toContain('налог: 7');
  });

  it('свои ставки показываются вместо дефолтных', () => {
    const text = settingsText({ ...STORE, commissionPercent: 25, taxPercent: 6 } as never);

    expect(text).toContain('25%');
    expect(text).toContain('6%');
    expect(text).not.toContain('23%');
  });

  it('видна общая скидка от прайса, формат правки и дорога к брендам', () => {
    const text = settingsText(STORE);

    expect(text).toContain('Скидка от прайса');
    expect(text).toContain('10%');
    expect(text).toContain('скидка: 10');
    // Скидки по брендам на этом экране НЕ перечисляются — их список зависит от
    // прайса продавца, — но дорога к ним обязана быть названа.
    expect(text).toContain('Скидки по брендам');
  });

  it('сказано, что в прайсе цена поставщика, а не закуп', () => {
    // Без этого объяснения сумма закупа в отчёте выглядит взятой с потолка:
    // в файле стоят другие числа.
    expect(settingsText(STORE)).toContain('цена поставщика');
  });

  it('своя скидка показывается вместо дефолтной', () => {
    const text = settingsText({
      ...STORE,
      discountPercent: 15,
    } as never);

    expect(text).toContain('15%');
    expect(text).not.toContain('10%');
  });

  it('до подключения магазина ставки не показываются', () => {
    // Экран без магазина обязан сказать ровно одну вещь: пришлите токен.
    const text = settingsText(null);

    expect(text).not.toContain('Комиссия');
    expect(text).not.toContain('Налог');
  });

  it('в тексте про ставки не появились идентификаторы магазина', () => {
    const text = settingsText(STORE);

    expect(text).not.toContain('12345678');
    expect(text).not.toContain('Campaign ID');
  });

  /**
   * Подсказки текстового ввода — с ТЕКУЩИМИ значениями.
   *
   * Дефект был ровно такой: сверху экран печатал «Комиссия 25 %», а снизу
   * предлагал прислать «комиссия: 23», потому что примеры стояли литералами.
   */
  it('подсказка правки несёт текущее значение, а не зашитое', () => {
    const text = settingsText({ ...STORE, commissionPercent: 25, taxPercent: 6 } as never);

    expect(text).toContain('комиссия: 25');
    expect(text).toContain('налог: 6');
    expect(text).not.toContain('комиссия: 23');
  });
});

/**
 * Кнопки экрана настроек — из того же источника, что и его текст.
 *
 * Экран открывается из трёх мест, и клавиатура повторяет судьбу текста: три
 * копии разошлись бы так же. Поэтому и проверка та же — чтением исходников.
 */
describe('Кнопки правки ставок', () => {
  const BOT = resolve(__dirname, '../../src/modules/telegram/bots/price-changer-bot');
  const read = (file: string) =>
    readFileSync(join(BOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  const STORE = {
    campaign_id: '12345678',
    business_id: '87654321',
    token: 'ACMA:secret:value',
    name: 'allbestwatch.ru',
  } as never;

  it('все три входа в экран строят клавиатуру одной функцией', () => {
    for (const file of [
      'handlers/menu-commands.handler.ts',
      'handlers/slash-commands.handler.ts',
      'handlers/callback-query.handler.ts',
    ]) {
      expect(read(file)).toContain('settingsKeyboardRows(');
    }
  });

  it('на каждую ставку своя кнопка, и значение написано на ней', () => {
    const rows = settingsKeyboardRows(STORE);
    const buttons = rows.flat();

    for (const field of RATE_FIELDS) {
      const button = buttons.find((b) => b.callback_data === rateCallback(field));
      expect(button, field).toBeDefined();
      expect(button!.text).toContain(`${DEFAULT_RATES[field]}%`);
    }
  });

  it('на кнопке текущее значение продавца, а не дефолт', () => {
    const buttons = settingsKeyboardRows({
      ...STORE,
      commissionPercent: 25,
      discountPercent: 7,
    } as never).flat();

    const commission = buttons.find((b) => b.callback_data === rateCallback('commissionPercent'))!;
    const discount = buttons.find((b) => b.callback_data === rateCallback('discountPercent'))!;

    expect(commission.text).toContain('25%');
    expect(discount.text).toContain('7%');
  });

  it('кнопка «Скидки по брендам» есть у подключённого магазина и только у него', () => {
    const configured = settingsKeyboardRows(STORE).flat();
    expect(configured.some((b) => b.callback_data === BRAND_CB_MENU)).toBe(true);

    // Без магазина скидки писать некуда — и кнопки быть не должно.
    const empty = settingsKeyboardRows(null).flat();
    expect(empty.some((b) => b.callback_data === BRAND_CB_MENU)).toBe(false);
  });

  it('до подключения магазина кнопок ставок нет', () => {
    // Ставок на этом экране нет тоже: он обязан сказать ровно одну вещь —
    // пришлите токен.
    const buttons = settingsKeyboardRows(null).flat();

    for (const field of RATE_FIELDS) {
      expect(buttons.some((b) => b.callback_data === rateCallback(field))).toBe(false);
    }
    // Выход из экрана остаётся: тупик без единой кнопки хуже.
    expect(buttons).toHaveLength(1);
  });

  it('кнопка «Продвижение» есть у подключённого, гейтится фичей и скрыта без магазина', () => {
    // Единственная гейтящаяся кнопка экрана: ставки и скидки флагом не
    // закрываются. Клавиатура обязана говорить то же, что гейт, — прятать
    // кнопку, тап по которой ответит отказом.
    const configured = settingsKeyboardRows(STORE).flat();
    expect(configured.some((b) => b.callback_data === PROMO_CB_MENU)).toBe(true);

    // Явно выключенная фича прячет кнопку; текст перестаёт её обещать.
    const disabled = settingsKeyboardRows(STORE, { promotion: false }).flat();
    expect(disabled.some((b) => b.callback_data === PROMO_CB_MENU)).toBe(false);
    expect(settingsText(STORE, { promotion: false })).not.toContain('Продвижение');
    expect(settingsText(STORE)).toContain('Продвижение');

    // Без магазина настраивать нечего — и кнопки быть не должно.
    const empty = settingsKeyboardRows(null).flat();
    expect(empty.some((b) => b.callback_data === PROMO_CB_MENU)).toBe(false);
  });

  it('кнопки «Сменить магазин» на экране настроек НЕТ — она переехала в главное меню', () => {
    // Раньше была inline-кнопкой в настройках; теперь reply-кнопка главного меню
    // (показывается при >1 магазине). На экране настроек её быть не должно.
    const inSettings = settingsKeyboardRows(STORE)
      .flat()
      .some((b) => b.callback_data === 'switch_store');
    expect(inSettings).toBe(false);
  });

  it('в подписях кнопок нет идентификаторов магазина', () => {
    const text = settingsKeyboardRows(STORE)
      .flat()
      .map((b) => b.text)
      .join(' ');

    expect(text).not.toContain('12345678');
    expect(text).not.toContain('87654321');
  });
});

describe('Справка не спорит с кодом', () => {
  it('справка обещает только токен — как и визард', () => {
    const text = helpText();
    expect(text).toContain('только API-токен');
    // «Три значения» — формулировка до TASK-050, когда id вводились руками.
    expect(text).not.toContain('три значения');
  });
});
