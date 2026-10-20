import { describe, it, expect } from 'vitest';

import {
  FEATURE,
  FEATURE_KEYS,
  FEATURE_META,
  allFeaturesEnabled,
  enabledIn,
  enabledReports,
  featureFlag,
  featureGraphProblems,
  featureMenuLayout,
  featureOfReport,
  isFeatureEnabled,
  isFeatureKey,
  isFeatureOpen,
  isPrevMonthOpen,
  isReportEnabled,
  openIn,
  requiredFeatures,
  resolveFeatureFlags,
  resolveFeatures,
} from '../../src/modules/telegram/bots/shared/features.domain';
import {
  MENU,
  MENU_LABELS,
  menuLayout,
} from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';
import {
  parseReportCallback,
  reportCallback,
  scheduleCallback,
} from '../../src/modules/telegram/bots/price-changer-bot/report-buttons';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';

/**
 * Реестр возможностей и правила «что чем закрывается».
 *
 * Ошибка здесь не даёт ни ошибки компиляции, ни падения в рантайме: гейт
 * просто начинает пускать туда, куда не должен, либо прячет кнопку, которую
 * прятать не просили. Ровно поэтому модуль чистый и проверяется тестами.
 */
describe('Реестр возможностей', () => {
  it('у каждого ключа есть описание, подпись и умолчание', () => {
    for (const key of FEATURE_KEYS) {
      expect(FEATURE_META[key].label).toBeTruthy();
      expect(FEATURE_META[key].description).toBeTruthy();
      expect(typeof FEATURE_META[key].defaultEnabled).toBe('boolean');
    }
  });

  it('FEATURE_KEYS перечисляет ВСЕ ключи реестра', () => {
    // Собирается из Record<TFeatureKey, true>, а не массивом-литералом: пропуск
    // в массиве компилятор не ловит, и фича стала бы непереключаемой.
    expect([...FEATURE_KEYS].sort()).toEqual([...Object.values(FEATURE)].sort());
  });

  it('ключи не дублируются', () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
  });

  it('старые возможности открыты по умолчанию, новые обкатываемые — нет', () => {
    // Флаги появились позже самих функций: существующие продавцы не должны
    // были ничего потерять, и разовой миграции для этого не потребовалось —
    // все прежние фичи остаются default-on. Новые, ещё не обкатанные («Склады»,
    // «FBY», строка калькулятора тарифов), вводятся с default-off и включаются
    // точечно из панели.
    const DEFAULT_OFF: string[] = [
      FEATURE.WAREHOUSES,
      FEATURE.FBY,
      FEATURE.TARIFF_CALC,
      FEATURE.PRICE_QUARANTINE,
      FEATURE.GOODS_FEEDBACK,
      FEATURE.PAYMENTS_REPORT,
      FEATURE.PRICE_RECOMMENDATIONS,
      FEATURE.MARKET_REPORTS,
      FEATURE.OFFER_CARDS,
      FEATURE.DEEP_HISTORY,
      FEATURE.FBY_SUPPLY,
      FEATURE.AI,
      FEATURE.FINANCE,
      FEATURE.EXPENSES,
      FEATURE.TAXES,
      FEATURE.TAX_YEAR,
      FEATURE.PURCHASES,
      FEATURE.OVERVIEW,
      FEATURE.UNIT_ECONOMICS,
      FEATURE.SALES_ANALYTICS,
      FEATURE.MARKETPLACE_COMPARE,
      FEATURE.INVENTORY,
      FEATURE.ORDER_FEED,
      FEATURE.RETURNS_ANALYTICS,
      FEATURE.STOCK_PUSH,
      FEATURE.STOCK_PUSH_WRITE_YM,
      FEATURE.STOCK_PUSH_WRITE_OZON,
      FEATURE.STOCK_PUSH_WRITE_WB,
      FEATURE.STOCK_PUSH_SCHEDULE,
      FEATURE.SKU_RATINGS,
      FEATURE.FORECAST,
      FEATURE.PRICE_CALCULATOR,
      FEATURE.FINANCE_ANOMALIES,
      FEATURE.FINANCE_UPLOAD,
      FEATURE.PROFIT_ACTUAL,
      FEATURE.OZON,
      FEATURE.WB,
      FEATURE.AI_ANALYST,
      FEATURE.AI_PERIOD_REVIEW,
      FEATURE.PRODUCTS,
      FEATURE.FEEDBACK_AI_REPLY,
      FEATURE.NOTIFICATIONS,
      FEATURE.NOTIFICATIONS_TELEGRAM,
      FEATURE.AI_WEEKLY_DIGEST,
    ];
    for (const key of FEATURE_KEYS) {
      expect(FEATURE_META[key].defaultEnabled, key).toBe(!DEFAULT_OFF.includes(key));
    }
  });

  it('подписи отчётов совпадают с кнопками меню', () => {
    // Иначе панель называет возможность одним словом, а бот — другим.
    for (const key of FEATURE_KEYS) {
      if (!key.startsWith('report_') && key !== FEATURE.SCHEDULE) continue;
      expect(MENU_LABELS).toContain(FEATURE_META[key].label);
    }
  });

  it('isFeatureKey отсеивает чужое', () => {
    expect(isFeatureKey(FEATURE.REPORT_PROFIT)).toBe(true);
    expect(isFeatureKey('status')).toBe(false);
    expect(isFeatureKey('toString')).toBe(false);
    expect(isFeatureKey(undefined)).toBe(false);
    expect(isFeatureKey(42)).toBe(false);
  });
});

describe('Разрешение флага', () => {
  it('отсутствие карты — это умолчание, а не «выключено»', () => {
    expect(isFeatureEnabled(undefined, FEATURE.REPORT_PROFIT)).toBe(true);
    expect(isFeatureEnabled({}, FEATURE.REPORT_PROFIT)).toBe(true);
  });

  it('явное решение администратора перекрывает умолчание', () => {
    expect(isFeatureEnabled({ [FEATURE.REPORT_PROFIT]: false }, FEATURE.REPORT_PROFIT)).toBe(false);
  });

  it('решение по одной фиче не задевает соседние', () => {
    const features = { [FEATURE.REPORT_PROFIT]: false };
    expect(isFeatureEnabled(features, FEATURE.REPORT_REDEEMED)).toBe(true);
    expect(isFeatureEnabled(features, FEATURE.STOCK_UPDATE)).toBe(true);
    expect(isFeatureEnabled(features, FEATURE.PURCHASE_PRICES)).toBe(true);
  });

  it('resolveFeatures отдаёт значение для КАЖДОГО ключа', () => {
    const resolved = resolveFeatures({ [FEATURE.SCHEDULE]: false });
    expect(Object.keys(resolved).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(resolved[FEATURE.SCHEDULE]).toBe(false);
    expect(resolved[FEATURE.REPORT_REDEEMED]).toBe(true);
  });

  it('неизвестный ключ отчёта считается закрытым', () => {
    // pendingReportDay лежит в базе с прошлых версий, а callback_data правится
    // руками: показывать по мусорному ключу нечего.
    expect(isReportEnabled(undefined, 'нет_такого')).toBe(false);
    expect(isReportEnabled(undefined, undefined)).toBe(false);
    expect(isReportEnabled(undefined, REPORT.PROFIT)).toBe(true);
  });

  it('каждому отчёту сопоставлена своя фича', () => {
    const features = Object.values(REPORT).map(featureOfReport);
    expect(features.every(Boolean)).toBe(true);
    expect(new Set(features).size).toBe(Object.values(REPORT).length);
  });
});

describe('«Прошлый месяц» и «Фактическая чистая» (TASK-126)', () => {
  it('profit_actual закрыт по умолчанию и требует finance', () => {
    expect(isFeatureEnabled({}, FEATURE.PROFIT_ACTUAL)).toBe(false);
    expect(isFeatureEnabled({ [FEATURE.PROFIT_ACTUAL]: true }, FEATURE.PROFIT_ACTUAL)).toBe(false);
    expect(
      isFeatureEnabled(
        { [FEATURE.PROFIT_ACTUAL]: true, [FEATURE.FINANCE]: true },
        FEATURE.PROFIT_ACTUAL,
      ),
    ).toBe(true);
  });

  it('«Прошлый месяц» открыт только при profit_actual и deep_history', () => {
    const actual = { [FEATURE.FINANCE]: true, [FEATURE.PROFIT_ACTUAL]: true };
    expect(isPrevMonthOpen(actual)).toBe(false);
    expect(isPrevMonthOpen({ [FEATURE.DEEP_HISTORY]: true })).toBe(false);
    expect(isPrevMonthOpen({ ...actual, [FEATURE.DEEP_HISTORY]: true })).toBe(true);
    expect(isPrevMonthOpen(allFeaturesEnabled())).toBe(true);
  });

  it('кнопка «Прошлый месяц» требует ещё profit_actual и deep_history — гейт ловит старую кнопку', () => {
    expect(
      requiredFeatures({ callbackData: reportCallback(PERIOD.PREV_MONTH, REPORT.PROFIT) }),
    ).toEqual([FEATURE.REPORT_PROFIT, FEATURE.PROFIT_ACTUAL, FEATURE.DEEP_HISTORY]);
    expect(requiredFeatures({ callbackData: reportCallback(PERIOD.MONTH, REPORT.PROFIT) })).toEqual(
      [FEATURE.REPORT_PROFIT],
    );
  });

  it('«Прошлый месяц» у других отчётов — не наш callback', () => {
    expect(parseReportCallback('rep:prevmonth:profit')).toEqual({
      period: PERIOD.PREV_MONTH,
      reportKey: REPORT.PROFIT,
    });
    expect(parseReportCallback('rep:prevmonth:redeemed')).toBeNull();
    expect(parseReportCallback('rep:prevmonth:tariff_calc')).toBeNull();
  });
});

describe('Какие возможности нужны апдейту', () => {
  it('кнопка отчёта требует свой отчёт и только его', () => {
    expect(requiredFeatures({ text: MENU.PROFIT })).toEqual([FEATURE.REPORT_PROFIT]);
    expect(requiredFeatures({ text: MENU.REDEEMED })).toEqual([FEATURE.REPORT_REDEEMED]);
    expect(requiredFeatures({ text: MENU.SHIPPED_TODAY })).toEqual([FEATURE.REPORT_SHIPPED_TODAY]);
    expect(requiredFeatures({ text: MENU.RETURNING })).toEqual([FEATURE.REPORT_RETURNING]);
    expect(requiredFeatures({ text: MENU.IN_TRANSIT })).toEqual([FEATURE.REPORT_IN_TRANSIT]);
  });

  it('кнопка рассылки требует рассылку', () => {
    expect(requiredFeatures({ text: MENU.SCHEDULE })).toEqual([FEATURE.SCHEDULE]);
  });

  it('кнопка складов требует фичу складов', () => {
    expect(requiredFeatures({ text: MENU.WAREHOUSES })).toEqual([FEATURE.WAREHOUSES]);
  });

  it('кнопка FBY требует фичу FBY', () => {
    expect(requiredFeatures({ text: MENU.FBY })).toEqual([FEATURE.FBY]);
  });

  it('кнопки, без которых пользователь запрётся снаружи, не гейтятся', () => {
    for (const label of [MENU.MAIN, MENU.SETTINGS, MENU.HELP, MENU.PROFILE, MENU.USERS]) {
      expect(requiredFeatures({ text: label })).toEqual([]);
    }
  });

  it('свободный текст и команды не гейтятся', () => {
    expect(requiredFeatures({ text: '/start' })).toEqual([]);
    expect(requiredFeatures({ text: 'ACMA:секрет' })).toEqual([]);
    expect(requiredFeatures({ text: '28-07-2026' })).toEqual([]);
    expect(requiredFeatures({})).toEqual([]);
  });

  it('кнопка периода отчёта требует тот же отчёт, что и кнопка меню', () => {
    for (const key of Object.values(REPORT)) {
      expect(requiredFeatures({ callbackData: reportCallback(PERIOD.MONTH, key) })).toEqual([
        featureOfReport(key),
      ]);
    }
  });

  it('включение рассылки отчёта требует ОБЕ возможности', () => {
    // Иначе дайджест закрытого отчёта можно было бы завести через раздел
    // рассылки, обойдя запрет на сам отчёт.
    expect(requiredFeatures({ callbackData: scheduleCallback('on', REPORT.PROFIT) })).toEqual([
      FEATURE.SCHEDULE,
      FEATURE.REPORT_PROFIT,
    ]);
  });

  it('возврат в раздел рассылки требует только рассылку', () => {
    expect(requiredFeatures({ callbackData: scheduleCallback('menu') })).toEqual([
      FEATURE.SCHEDULE,
    ]);
  });

  it('прочие inline-кнопки не гейтятся', () => {
    for (const data of [
      'main_menu',
      'check_settings',
      'onboarding_restart',
      'adm:ap:1',
      'rate:x',
    ]) {
      expect(requiredFeatures({ callbackData: data })).toEqual([]);
    }
  });

  it('кнопки продвижения требуют фичу продвижения', () => {
    // `rate:` и `bdisc:` не гейтятся (настройки должны оставаться доступными),
    // а продвижение гейтится: это и есть его фича, других входов у неё нет.
    for (const data of ['promo:menu', 'promo:pick:casio', 'promo:tier:casio', 'promo:off:vostok']) {
      expect(requiredFeatures({ callbackData: data })).toEqual([FEATURE.PROMOTION]);
    }
  });

  it('мусор с промо-префиксом не гейтится — он и не обрабатывается', () => {
    expect(requiredFeatures({ callbackData: 'promo:xxx' })).toEqual([]);
    expect(requiredFeatures({ callbackData: 'promo:pick:rolex' })).toEqual([]);
  });

  it('кнопки новых экранов требуют свои фичи', () => {
    // Кнопки карантина и отзывов живут в истории чата вечно, кнопка периода
    // платежей — тоже: раскладка меню от них не защищает, гейтит только это.
    for (const data of ['pq:ok:0', 'pq:all']) {
      expect(requiredFeatures({ callbackData: data })).toEqual([FEATURE.PRICE_QUARANTINE]);
    }
    for (const data of ['fb:re:123', 'fb:skip:123', 'fb:send:123', 'fb:cancel']) {
      expect(requiredFeatures({ callbackData: data })).toEqual([FEATURE.GOODS_FEEDBACK]);
    }
    // «✨ Предложить ответ» — своя фича поверх отзывов (TASK-167).
    expect(requiredFeatures({ callbackData: 'fb:ai:123' })).toEqual([
      FEATURE.GOODS_FEEDBACK,
      FEATURE.FEEDBACK_AI_REPLY,
    ]);
    for (const data of ['pay:week', 'pay:month', 'pay:prevmonth']) {
      expect(requiredFeatures({ callbackData: data })).toEqual([FEATURE.PAYMENTS_REPORT]);
    }
    // Ряд «🔔 Уведомления» в «⏰ Рассылке» (TASK-152) — своя фича, не `schedule`.
    for (const data of ['ntf:on', 'ntf:off', 'ntf:time']) {
      expect(requiredFeatures({ callbackData: data })).toEqual([FEATURE.NOTIFICATIONS_TELEGRAM]);
    }
  });

  it('мусор с новыми префиксами не гейтится — он и не обрабатывается', () => {
    for (const data of ['pq:xxx', 'fb:re:abc', 'pay:year']) {
      expect(requiredFeatures({ callbackData: data })).toEqual([]);
    }
  });

  it('кнопки новых экранов меню требуют свои фичи', () => {
    expect(requiredFeatures({ text: MENU.QUARANTINE })).toEqual([FEATURE.PRICE_QUARANTINE]);
    expect(requiredFeatures({ text: MENU.FEEDBACK })).toEqual([FEATURE.GOODS_FEEDBACK]);
    expect(requiredFeatures({ text: MENU.PAYMENTS })).toEqual([FEATURE.PAYMENTS_REPORT]);
    expect(requiredFeatures({ text: MENU.PRICE_RECOMMENDATIONS })).toEqual([
      FEATURE.PRICE_RECOMMENDATIONS,
    ]);
    expect(requiredFeatures({ text: MENU.MARKET_REPORTS })).toEqual([FEATURE.MARKET_REPORTS]);
    expect(requiredFeatures({ text: MENU.OFFER_CARDS })).toEqual([FEATURE.OFFER_CARDS]);
  });

  it('кнопки раздела отчётов Маркета требуют фичу раздела', () => {
    for (const data of ['mkt:menu', 'mkt:real', 'mkt:real:2026:7', 'mkt:comp:123:prevmonth']) {
      expect(requiredFeatures({ callbackData: data })).toEqual([FEATURE.MARKET_REPORTS]);
    }
    expect(requiredFeatures({ callbackData: 'mkt:xxx' })).toEqual([]);
  });

  it('deep_history, fby_supply, hosting_reminder и ai кнопок не чеканят — гейт их не знает', () => {
    // Первые два флага читаются в run/payload (прецедент TARIFF_CALC-строки), а
    // не гейтом: у них нет ни кнопки меню, ни своего callback-префикса.
    expect(MENU_LABELS).not.toContain(FEATURE_META[FEATURE.DEEP_HISTORY].label);
    expect(MENU_LABELS).not.toContain(FEATURE_META[FEATURE.FBY_SUPPLY].label);
    // У напоминания об оплате апдейта нет вовсе: это фоновая рассылка, флаг
    // читает её процессор. Кнопка была бы просто нечем.
    expect(MENU_LABELS).not.toContain(FEATURE_META[FEATURE.HOSTING_REMINDER].label);
    // ИИ — тоже без апдейта: флаг читает AiService, получая готовый boolean.
    expect(MENU_LABELS).not.toContain(FEATURE_META[FEATURE.AI].label);
  });

  it('ai по умолчанию закрыт, явное решение открывает', () => {
    // Запросы оплачивает владелец из одного ключа — открывается по одному продавцу.
    expect(isFeatureEnabled({}, FEATURE.AI)).toBe(false);
    expect(isFeatureEnabled(undefined, FEATURE.AI)).toBe(false);
    expect(isFeatureEnabled({ ai: true }, FEATURE.AI)).toBe(true);
  });

  it('документ гейтом не закрывается — решение у stock-upload.handler', () => {
    // Прайс делает два независимых дела (закуп и остатки), каждое под своей
    // фичей, и исход бывает частичным. Гейт умеет отбить апдейт только
    // целиком, поэтому по документам он обязан молчать.
    expect(requiredFeatures({ hasDocument: true })).toEqual([]);
  });

  it('подпись к документу ничего не решает', () => {
    // У прайса бывает подпись «проверка», и она не должна уводить апдейт в
    // ветку «это кнопка меню» — иначе подпись «💰 Прибыль» гейтила бы файл
    // как отчёт.
    expect(requiredFeatures({ hasDocument: true, text: MENU.PROFIT })).toEqual([]);
  });
});

describe('Раскладка меню по возможностям', () => {
  it('без ограничений видны все default-on кнопки, но не выключенные по умолчанию', () => {
    // «Склады» и «FBY» — default-off И только для FBY-магазина, «Калькулятор» —
    // просто default-off, поэтому у продавца без явного решения этих кнопок
    // нет; их ряды схлопываются или худеют. Остальная раскладка — прежняя.
    const HIDDEN_BY_DEFAULT: string[] = [
      MENU.WAREHOUSES,
      MENU.FBY,
      MENU.TARIFF_CALC,
      MENU.QUARANTINE,
      MENU.FEEDBACK,
      MENU.PAYMENTS,
      MENU.PRICE_RECOMMENDATIONS,
      MENU.MARKET_REPORTS,
      MENU.OFFER_CARDS,
    ];
    const layout = featureMenuLayout(undefined);
    for (const label of HIDDEN_BY_DEFAULT) expect(layout.flat()).not.toContain(label);
    expect(layout).toEqual(
      menuLayout()
        .map((row) => row.filter((l) => !HIDDEN_BY_DEFAULT.includes(l)))
        .filter((row) => row.length),
    );
  });

  it('кнопки склада Маркета требуют И включённую фичу, И FBY-магазин', () => {
    const enabled = { [FEATURE.WAREHOUSES]: true, [FEATURE.FBY]: true };
    // Оба условия выполнены — кнопка на месте.
    expect(featureMenuLayout(enabled, 'FBY').flat()).toContain(MENU.FBY);
    // Фича включена, но магазин FBS (или модель неизвестна) — кнопок нет.
    expect(featureMenuLayout(enabled, 'FBS').flat()).not.toContain(MENU.FBY);
    expect(featureMenuLayout(enabled).flat()).not.toContain(MENU.FBY);
    // Магазин FBY, но фичи выключены (умолчание) — кнопок тоже нет.
    expect(featureMenuLayout(undefined, 'FBY').flat()).not.toContain(MENU.FBY);

    // «🏬 Склады» временно вне раскладки: ряд убран из MENU_LAYOUT, поэтому
    // фича и модель на неё уже не влияют — кнопки нет ни при каких условиях.
    expect(featureMenuLayout(enabled, 'FBY').flat()).not.toContain(MENU.WAREHOUSES);
  });

  it('модель сравнивается без регистра — Маркет строку не типизирует', () => {
    const enabled = { [FEATURE.FBY]: true };
    expect(featureMenuLayout(enabled, ' fby ').flat()).toContain(MENU.FBY);
  });

  it('кнопка закрытой возможности исчезает', () => {
    const layout = featureMenuLayout({ [FEATURE.REPORT_PROFIT]: false }).flat();
    expect(layout).not.toContain(MENU.PROFIT);
    expect(layout).toContain(MENU.REDEEMED);
  });

  it('опустевший ряд не остаётся пустым', () => {
    // «Прибыль» занимает ряд одна: без схлопывания Telegram получил бы ряд без
    // кнопок и отверг бы клавиатуру целиком.
    const layout = featureMenuLayout({ [FEATURE.REPORT_PROFIT]: false });
    expect(layout.every((row) => row.length > 0)).toBe(true);
  });

  it('настройки и справка остаются при всех закрытых возможностях', () => {
    const closed = Object.fromEntries(FEATURE_KEYS.map((key) => [key, false]));
    const layout = featureMenuLayout(closed).flat();
    expect(layout).toContain(MENU.SETTINGS);
    expect(layout).toContain(MENU.HELP);
    expect(layout).toContain(MENU.PROFILE);
  });

  it('раскладка мутабельна — телеграф ждёт обычный массив', () => {
    const pristine = featureMenuLayout(undefined);
    const layout = featureMenuLayout(undefined);
    layout.push(['x']);
    // Мутация одной копии не задевает следующий вызов.
    expect(featureMenuLayout(undefined)).toEqual(pristine);
  });
});

describe('Доступные отчёты', () => {
  it('без ограничений — все пять, в порядке меню', () => {
    expect(enabledReports(undefined)).toEqual([
      REPORT.SHIPPED_TODAY,
      REPORT.REDEEMED,
      REPORT.RETURNING,
      REPORT.IN_TRANSIT,
      REPORT.PROFIT,
    ]);
  });

  it('закрытый отчёт в список не попадает', () => {
    expect(enabledReports({ [FEATURE.REPORT_PROFIT]: false })).not.toContain(REPORT.PROFIT);
  });
});

describe('Зависимости фич (requires, TASK-153)', () => {
  // Синтетический реестр: «x» требует «ai», «y» требует «x» — транзитивно.
  const REGISTRY = {
    ai: { label: 'ИИ', description: '', defaultEnabled: false },
    x: { label: 'X', description: '', defaultEnabled: true, requires: ['ai'] },
    y: { label: 'Y', description: '', defaultEnabled: true, requires: ['x'] },
    fby: { label: 'FBY', description: '', defaultEnabled: true },
    z: { label: 'Z', description: '', defaultEnabled: true, requires: ['fby'] },
  } as never as Record<'ai' | 'x' | 'y' | 'fby' | 'z', (typeof FEATURE_META)[typeof FEATURE.AI]>;

  it('фича с requires:[ai] закрыта при закрытом ai и открывается вместе с ним', () => {
    expect(enabledIn(REGISTRY, {}, 'x')).toBe(false);
    expect(enabledIn(REGISTRY, { ai: true }, 'x')).toBe(true);
    // Свой флаг по-прежнему решает: зависимость открывает, но не включает.
    expect(enabledIn(REGISTRY, { ai: true, x: false }, 'x')).toBe(false);
  });

  it('зависимости транзитивны', () => {
    expect(enabledIn(REGISTRY, { ai: false }, 'y')).toBe(false);
    expect(enabledIn(REGISTRY, { ai: true }, 'y')).toBe(true);
  });

  it('модель FBY проверяется и у зависимости', () => {
    const fbyOnly = new Set(['fby']);
    expect(openIn(REGISTRY, fbyOnly, {}, 'z', 'FBS')).toBe(false);
    expect(openIn(REGISTRY, fbyOnly, {}, 'z', 'FBY')).toBe(true);
    expect(openIn(REGISTRY, fbyOnly, { ai: true }, 'x', 'FBS')).toBe(true);
    expect(openIn(REGISTRY, fbyOnly, {}, 'x', 'FBS')).toBe(false);
  });

  it('граф боевого реестра чист: все ключи известны, циклов нет', () => {
    expect(featureGraphProblems(FEATURE_META)).toEqual([]);
  });

  it('неизвестный ключ, зависимость от себя и цикл — ошибки реестра', () => {
    const meta = (requires: string[]) => ({
      label: '',
      description: '',
      defaultEnabled: true,
      requires,
    });
    expect(featureGraphProblems({ a: meta(['nope']) } as never)).toEqual([
      'a требует неизвестную фичу nope',
    ]);
    expect(featureGraphProblems({ a: meta(['a']) } as never)).toEqual(['цикл зависимостей: a → a']);
    expect(
      featureGraphProblems({ a: meta(['b']), b: meta(['c']), c: meta(['a']) } as never),
    ).toEqual(['цикл зависимостей: a → b → c → a']);
  });

  it('unit-экономика и аномалии требуют «Финансы»; обзор и калькулятор цен — нет', () => {
    expect(FEATURE_META[FEATURE.UNIT_ECONOMICS].requires).toEqual([FEATURE.FINANCE]);
    expect(FEATURE_META[FEATURE.FINANCE_ANOMALIES].requires).toEqual([FEATURE.FINANCE]);
    expect(FEATURE_META[FEATURE.OVERVIEW].requires).toBeUndefined();
    expect(FEATURE_META[FEATURE.PRICE_CALCULATOR].requires).toBeUndefined();
  });

  it('ИИ-аналитик требует и «ИИ», и «Финансы»: открыт только при обеих', () => {
    expect(FEATURE_META[FEATURE.AI_ANALYST].requires).toEqual([FEATURE.AI, FEATURE.FINANCE]);
    const own = { [FEATURE.AI_ANALYST]: true };
    expect(isFeatureEnabled(own, FEATURE.AI_ANALYST)).toBe(false);
    expect(isFeatureEnabled({ ...own, [FEATURE.AI]: true }, FEATURE.AI_ANALYST)).toBe(false);
    expect(isFeatureEnabled({ ...own, [FEATURE.FINANCE]: true }, FEATURE.AI_ANALYST)).toBe(false);
    expect(
      isFeatureEnabled({ ...own, [FEATURE.AI]: true, [FEATURE.FINANCE]: true }, FEATURE.AI_ANALYST),
    ).toBe(true);
  });

  it('ИИ-разбор периода требует и «ИИ», и «Финансы» (TASK-150)', () => {
    expect(FEATURE_META[FEATURE.AI_PERIOD_REVIEW].requires).toEqual([FEATURE.AI, FEATURE.FINANCE]);
    const own = { [FEATURE.AI_PERIOD_REVIEW]: true };
    expect(isFeatureEnabled({ ...own, [FEATURE.FINANCE]: true }, FEATURE.AI_PERIOD_REVIEW)).toBe(
      false,
    );
    expect(
      isFeatureEnabled(
        { ...own, [FEATURE.AI]: true, [FEATURE.FINANCE]: true },
        FEATURE.AI_PERIOD_REVIEW,
      ),
    ).toBe(true);
  });

  it('ИИ-ответ на отзыв требует и «Отзывы», и «ИИ» (TASK-167)', () => {
    expect(FEATURE_META[FEATURE.FEEDBACK_AI_REPLY].requires).toEqual([
      FEATURE.GOODS_FEEDBACK,
      FEATURE.AI,
    ]);
    const own = { [FEATURE.FEEDBACK_AI_REPLY]: true };
    expect(isFeatureEnabled({ ...own, [FEATURE.AI]: true }, FEATURE.FEEDBACK_AI_REPLY)).toBe(false);
    expect(
      isFeatureEnabled({ ...own, [FEATURE.GOODS_FEEDBACK]: true }, FEATURE.FEEDBACK_AI_REPLY),
    ).toBe(false);
    expect(
      isFeatureEnabled(
        { ...own, [FEATURE.AI]: true, [FEATURE.GOODS_FEEDBACK]: true },
        FEATURE.FEEDBACK_AI_REPLY,
      ),
    ).toBe(true);
  });

  it('боевая пара: unit-экономика открыта только вместе с «Финансами»', () => {
    const own = { [FEATURE.UNIT_ECONOMICS]: true };
    expect(isFeatureEnabled(own, FEATURE.UNIT_ECONOMICS)).toBe(false);
    expect(isFeatureOpen(own, FEATURE.UNIT_ECONOMICS, 'FBS')).toBe(false);
    expect(featureFlag(own, FEATURE.UNIT_ECONOMICS)).toBe(true);
    const both = { ...own, [FEATURE.FINANCE]: true };
    expect(isFeatureEnabled(both, FEATURE.UNIT_ECONOMICS)).toBe(true);
    expect(isFeatureOpen(both, FEATURE.UNIT_ECONOMICS, 'FBS')).toBe(true);
  });

  it('resolveFeatures — действующие значения, resolveFeatureFlags — собственные', () => {
    const own = { [FEATURE.FINANCE_ANOMALIES]: true };
    expect(resolveFeatures(own)[FEATURE.FINANCE_ANOMALIES]).toBe(false);
    expect(resolveFeatureFlags(own)[FEATURE.FINANCE_ANOMALIES]).toBe(true);
    // Снимок, разрешённый один раз, разрешается в то же самое (снимок CRM).
    const snapshot = resolveFeatures(own);
    expect(resolveFeatures(snapshot)).toEqual(snapshot);
  });

  it('админ: allFeaturesEnabled открывает и зависимости', () => {
    const admin = allFeaturesEnabled();
    for (const key of FEATURE_KEYS) expect(isFeatureEnabled(admin, key)).toBe(true);
  });
});
