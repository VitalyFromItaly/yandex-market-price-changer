import { describe, it, expect } from 'vitest';

import {
  FEATURE,
  FEATURE_KEYS,
  FEATURE_META,
  enabledReports,
  featureMenuLayout,
  featureOfReport,
  isFeatureEnabled,
  isFeatureKey,
  isReportEnabled,
  requiredFeatures,
  resolveFeatures,
} from '../../src/modules/telegram/bots/shared/features.domain';
import {
  MENU,
  MENU_LABELS,
  menuLayout,
} from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';
import {
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

  it('старые возможности открыты по умолчанию, новая — нет', () => {
    // Флаги появились позже самих функций: существующие продавцы не должны
    // были ничего потерять, и разовой миграции для этого не потребовалось —
    // все прежние фичи остаются default-on. «Склады» — первая обкатываемая
    // функция, введённая с default-off: она включается точечно из панели.
    for (const key of FEATURE_KEYS) {
      const expected = key === FEATURE.WAREHOUSES ? false : true;
      expect(FEATURE_META[key].defaultEnabled, key).toBe(expected);
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
    expect(isFeatureEnabled(features, FEATURE.STOCK_UPLOAD)).toBe(true);
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
    for (const data of ['main_menu', 'check_settings', 'onboarding_restart', 'adm:ap:1', 'rate:x']) {
      expect(requiredFeatures({ callbackData: data })).toEqual([]);
    }
  });

  it('документ требует загрузку прайса', () => {
    expect(requiredFeatures({ hasDocument: true })).toEqual([FEATURE.STOCK_UPLOAD]);
  });

  it('подпись к документу ничего не решает', () => {
    // У прайса бывает подпись «проверка», и она не должна уводить апдейт в
    // ветку «это кнопка меню».
    expect(requiredFeatures({ hasDocument: true, text: MENU.PROFIT })).toEqual([
      FEATURE.STOCK_UPLOAD,
    ]);
  });
});

describe('Раскладка меню по возможностям', () => {
  it('без ограничений видны все default-on кнопки, но не выключенные по умолчанию', () => {
    // «Склады» — default-off, поэтому у продавца без явного решения кнопки нет;
    // её ряд схлопывается целиком. Остальная раскладка — прежняя.
    const layout = featureMenuLayout(undefined);
    expect(layout.flat()).not.toContain(MENU.WAREHOUSES);
    expect(layout).toEqual(menuLayout().map((row) => row.filter((l) => l !== MENU.WAREHOUSES)).filter((row) => row.length));
  });

  it('явно включённая default-off кнопка появляется', () => {
    const layout = featureMenuLayout({ [FEATURE.WAREHOUSES]: true }).flat();
    expect(layout).toContain(MENU.WAREHOUSES);
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
