/**
 * ЕДИНСТВЕННЫЙ источник правды о подписях главного меню.
 *
 * Зачем понадобился. Раньше подписи задавались в ЧЕТЫРЁХ независимых местах:
 * `PriceChangerKeyboard.menuCommands`, `bot.hears` в `MenuCommandsHandler`,
 * ветка `main_menu` в `CallbackQueryHandler` и `isMenuButton()` в
 * `ApiSettingsHandler`. Списки разъехались — пересечение между клавиатурой и
 * `hears` стало ПУСТЫМ, и все кнопки меню молча перестали работать: нажатие
 * проваливалось в catch-all обработчик текста, который гасил его без ответа.
 * Ни компилятор, ни ревью такую рассинхронизацию не ловят.
 *
 * Правило: подпись кнопки менять ТОЛЬКО здесь. Тест
 * `__tests__/unit/menu-labels.test.ts` следит, что все потребители берут
 * значения отсюда и что раскладка не содержит меток вне справочника.
 */

export const MENU = {
  MAIN: '🏠 Главное меню',
  // Четыре отчёта. Подписи здесь же, чтобы кнопка и её hears не разъехались —
  // ровно та беда, ради которой файл и появился.
  SHIPPED_TODAY: '🚚 Уехало клиенту',
  REDEEMED: '✅ Выкуплено',
  RETURNING: '↩️ Едет обратно',
  IN_TRANSIT: '📦 Едет до клиента',
  SETTINGS: '⚙️ Настройки API',
  PROFILE: '📊 Мой профиль',
  HELP: '❓ Помощь',
} as const;

export type TMenuLabel = (typeof MENU)[keyof typeof MENU];

/** Все подписи одним списком — для проверки «это кнопка меню?». */
export const MENU_LABELS: readonly TMenuLabel[] = Object.values(MENU);

/**
 * Раскладка reply-клавиатуры: массив рядов.
 *
 * `MENU.MAIN` сюда намеренно НЕ входит: кнопка «Главное меню» приходит из
 * inline-веток и из стартовой клавиатуры, но дублировать её в самом главном
 * меню незачем. При этом `hears` на неё зарегистрирован — поэтому она есть
 * в MENU_LABELS, но отсутствует в раскладке.
 */
export const MENU_LAYOUT: readonly (readonly TMenuLabel[])[] = [
  [MENU.SHIPPED_TODAY, MENU.REDEEMED],
  [MENU.RETURNING, MENU.IN_TRANSIT],
  [MENU.SETTINGS],
  [MENU.HELP, MENU.PROFILE],
];

/** Раскладка в виде обычного массива — телеграф ждёт мутабельный тип. */
export function menuLayout(): string[][] {
  return MENU_LAYOUT.map((row) => [...row]);
}
