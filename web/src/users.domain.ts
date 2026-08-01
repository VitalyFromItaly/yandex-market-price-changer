import type { IFeature, IUserRow } from './api';

/**
 * Мелочи, общие для списка продавцов и карточки одного.
 *
 * Отдельный модуль, а не по копии в каждом компоненте: подпись статуса и
 * правило «как показать имя» встречаются на обоих экранах, и разъехавшись, они
 * назвали бы одно и то же состояние по-разному — на списке «доступ есть», на
 * карточке «одобрен». Ровно та беда, ради которой в боте появился
 * `menu.constants.ts`.
 */

/** Те же подписи, что показывает список пользователей в Telegram. */
export const STATUS_LABEL: Record<string, string> = {
  approved: '✅ доступ есть',
  pending: '⏳ ждёт решения',
  rejected: '⛔ доступа нет',
  new: '🆕 регистрируется',
};

export function displayName(user: IUserRow): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return name || user.username || user.telegramUserId;
}

/**
 * Сколько возможностей открыто. Считается по реестру с сервера, а не по ключам
 * самой карты: реестр — единственный источник правды о составе возможностей, и
 * фича, которой у продавца ещё нет в записи, всё равно должна попасть в
 * знаменатель.
 */
export function openFeatureCount(user: IUserRow, features: IFeature[]): number {
  return features.filter((feature) => user.features[feature.key]).length;
}

/** Доступ открыт — единственное состояние, в котором бот работает. */
export function isApproved(user: IUserRow): boolean {
  return user.status === 'approved';
}
