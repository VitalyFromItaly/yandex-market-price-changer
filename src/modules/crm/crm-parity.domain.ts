import type { MENU } from '../telegram/bots/price-changer-bot/menu.constants';
import type { TFeatureKey } from '../telegram/bots/shared/features.domain';

import { FEATURE } from '../telegram/bots/shared/features.domain';

/**
 * Паритет «бот ↔ CRM»: у каждой функции бота есть место в CRM.
 *
 * Требование владельца — «абсолютно весь функционал» бота в вебе. Без таблицы
 * оно держится на памяти: новая фича или кнопка бота без раздела CRM не роняет
 * ни компиляцию, ни тесты, и расхождение находит продавец. Таблицы ниже и
 * `crm-parity.test.ts` превращают его в красный CI.
 *
 * Чистый модуль, как `crm-features.domain.ts`: раздел — это ключ `CRM_SECTIONS`
 * (он же имя маршрута в `crm/src/navigation.ts`).
 */

/**
 * Фичи, у которых НЕТ своего раздела, — с причиной. Любая другая фича обязана
 * стоять в значениях `CRM_SECTIONS`.
 *
 * `Partial` намеренно: новая фича компилируется и без строки здесь, а краснеет
 * тест паритета — с именем ключа. Исключение, у которого появился раздел, тоже
 * ошибка: устаревшая причина вводит в заблуждение так же, как забытый раздел.
 */
export const FEATURES_WITHOUT_SECTION: Readonly<Partial<Record<TFeatureKey, string>>> = {
  [FEATURE.PROMOTION]:
    'Блок внутри «Настроек» (ym-settings), своего экрана нет и у бота; ' +
    'закрытая фича — promotion: null в GET и 403 на маршрутах записи.',
  [FEATURE.DEEP_HISTORY]:
    'Модификатор периода отчётов, а не экран: едет снимком features в payload задач CRM.',
  [FEATURE.FBY_SUPPLY]: 'Секция внутри «FBY» (ym-fby), читается из снимка features задачи.',
  [FEATURE.HOSTING_REMINDER]:
    'Фоновая рассылка в Telegram в последний день месяца: экрана нет ни в одном канале.',
};

export type TBotScreenParity = { section: string } | { botOnly: string };

/**
 * Кнопка главного меню бота → раздел CRM, где живёт тот же экран.
 *
 * Полный `Record`: новый ключ `MENU` не скомпилируется, пока ему не выбран
 * раздел или причина остаться только в боте. Прайс-документ кнопкой не
 * является — он покрыт фичами `purchase_prices`/`stock_update` → `ym-price-list`.
 */
export const BOT_SCREEN_SECTIONS: Readonly<Record<keyof typeof MENU, TBotScreenParity>> = {
  // Главное меню бота — клавиатура; в вебе стартовый экран магазина.
  MAIN: { section: 'ym-dashboard' },
  SHIPPED_TODAY: { section: 'ym-orders' },
  REDEEMED: { section: 'ym-orders' },
  RETURNING: { section: 'ym-orders' },
  IN_TRANSIT: { section: 'ym-orders' },
  PROFIT: { section: 'ym-profit' },
  // Вкладка раздела «Прибыль» (решение 2026-09-24).
  TARIFF_CALC: { section: 'ym-profit' },
  // Кнопка сейчас вне MENU_LAYOUT, но экран бота жив (hears, фича, хендлер).
  WAREHOUSES: { section: 'ym-warehouses' },
  FBY: { section: 'ym-fby' },
  QUARANTINE: { section: 'ym-quarantine' },
  FEEDBACK: { section: 'ym-feedback' },
  PAYMENTS: { section: 'ym-payments' },
  PRICE_RECOMMENDATIONS: { section: 'ym-recommendations' },
  MARKET_REPORTS: { section: 'ym-market-reports' },
  OFFER_CARDS: { section: 'ym-offer-cards' },
  // Раздел пока заглушка SectionPlaceholder: «Рассылка» в CRM — TASK-081,
  // владелец её пропустил. Маршрут и пункт навигации есть — паритет держит место.
  SCHEDULE: { section: 'ym-schedule' },
  SETTINGS: { section: 'ym-settings' },
  // В вебе магазин не переключают, а открывают из списка (TASK-079).
  SWITCH_STORE: { section: 'ym-stores' },
  PROFILE: { section: 'profile' },
  HELP: { section: 'help' },
  USERS: {
    botOnly:
      'Экран администратора; в вебе его заменяет панель администратора (web/), ' +
      'а CRM — кабинет продавца.',
  },
};
