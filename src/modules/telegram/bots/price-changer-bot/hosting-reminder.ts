import type { TFeatureMap } from '../shared/features.domain';

import { FEATURE, isFeatureEnabled } from '../shared/features.domain';

/**
 * Напоминание об оплате хостинга — единственная рассылка «всем сразу».
 *
 * Чистый модуль: ни Nest, ни telegraf, ни Mongo (паттерн `access-decision.text.ts`).
 * Здесь и текст, и правило «кому уходит» — то есть ровно те две вещи, ошибка в
 * которых ничего не роняет: рассылка просто уходит не тем или не уходит вовсе.
 * Проверяется обычными юнит-тестами.
 */

/**
 * Текст. Одна копия — отправитель один, но правило «один экран — один текст»
 * действует и здесь: следующий вход (скрипт предпросмотра) берёт эту же строку,
 * а не свою.
 *
 * Почему сказано, что день последний: сообщение приходит раз в месяц и без
 * объяснения выглядит случайным. Разметка HTML — общий режим бота.
 */
export const HOSTING_REMINDER_TEXT = [
  '💳 <b>Напоминание об оплате</b>',
  '',
  'Сегодня последний день месяца — не забудьте оплатить расходы на хостинг,',
  'иначе бот остановится.',
].join('\n');

/** Что рассылке нужно знать о пользователе. */
export interface IReminderCandidate {
  telegramUserId: string;
  telegramChatId: string;
  status: string;
  features?: TFeatureMap;
}

/** Кому шлём: id пользователя и чат, куда писать. */
export interface IReminderRecipient {
  telegramUserId: string;
  telegramChatId: string;
}

/**
 * Отбор получателей: одобренный + подключённый магазин + фича открыта.
 *
 * - **Одобренный.** Ожидающему и отклонённому напоминание об оплате бессмысленно:
 *   бот им ничего не считает.
 * - **С подключённым магазином.** Нагрузку на хостинг создаёт тот, кто прислал
 *   токен; одобренный, но так и не подключившийся, ничем не пользуется.
 *   Множество приходит снаружи одним `$in`-запросом — проверять `isConfigured`
 *   построчно значит запрос на каждого (довод из `AccessController`).
 * - **Фича `hosting_reminder`.** По умолчанию включена: рассылка нужна всем, а
 *   закрыть её конкретному продавцу администратор может тумблером в панели.
 *   Отсутствие ключа — не «выключено», а «не настраивали».
 *
 * Чат без адреса пропускается молча: `sendMessage` без chat_id всё равно
 * ответил бы 400, а вот падение рассылки на одном битом документе лишило бы
 * напоминания всех остальных.
 */
export function pickRecipients(
  candidates: readonly IReminderCandidate[],
  configuredUserIds: ReadonlySet<string>,
): IReminderRecipient[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.status === 'approved' &&
        !!candidate.telegramChatId &&
        configuredUserIds.has(candidate.telegramUserId) &&
        isFeatureEnabled(candidate.features, FEATURE.HOSTING_REMINDER),
    )
    .map(({ telegramUserId, telegramChatId }) => ({ telegramUserId, telegramChatId }));
}
