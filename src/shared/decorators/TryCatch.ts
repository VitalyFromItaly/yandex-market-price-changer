/**
 * @deprecated НЕ ИСПОЛЬЗОВАТЬ. Оставлен только как памятник и чтобы не сломать
 * ссылки в истории. Ни один живой класс его больше не применяет (TASK-013).
 *
 * Почему выпилен. Декоратор ловит исключение и возвращает `undefined`, НЕ делая
 * rethrow. Навешенный на класс целиком (`@DecorateMethodsWith(TryCatch())`) он:
 *
 * 1. Прятал падения запуска: при битом токене `launch()` тихо «успевал», и
 *    приложение рапортовало «Telegram bots initialized» на неработающем боте.
 * 2. Превращал ошибку в `undefined` у `checkUserSubscription`, после чего
 *    вызывающий код падал на `.hasActiveSubscription` с TypeError — то есть
 *    настоящая причина заменялась бессмысленной.
 * 3. Ломал retry в очередях: Bull повторяет джобу по ИСКЛЮЧЕНИЮ, а проглоченная
 *    ошибка выглядела как успешное выполнение.
 * 4. Делал синхронные методы асинхронными — обёртка всегда `async`.
 *
 * Что вместо него: `bot.catch()` в BotRegistry как единая точка на бота,
 * проброс исключений в обработчиках очередей и точечный `try/catch` там,
 * где действительно нужен мягкий сценарий.
 */
export default function TryCatch() {
  return function (_target: any, _propertyKey: string, descriptor?: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        console.error(_propertyKey, 'Ошибка при получении данных:', error);
      }
    };

    return descriptor;
  };
}
