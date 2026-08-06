import type { IActionLogRow, IFeature, IUserRow } from './api';

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

/** Вариант выпадающего списка «кого показывать» в журнале. */
export interface IUserOption {
  /** Ровно тот telegramUserId, по которому фильтрует бэкенд. */
  value: string;
  label: string;
  /** Собран из самих записей журнала, а не из списка доступа. */
  fromLog?: boolean;
}

/**
 * Варианты фильтра журнала: продавцы плюс те, кто в списке доступа не значится.
 *
 * Одним списком доступа обойтись нельзя. У администратора записи `UserAccess`
 * нет вовсе (гейт пропускает его раньше, чем она создаётся), а ошибки HTTP и
 * процесса пишутся на `telegramUserId: 'system'` — без второй половины их
 * действия нечем отобрать. Поэтому к продавцам добавляются id, встреченные в
 * уже загруженных строках: подпись для них берётся из самой записи, где ник и
 * имя сохранены на момент действия.
 */
export function logUserOptions(
  users: IUserRow[],
  rows: IActionLogRow[],
  selected: string,
): IUserOption[] {
  const options = new Map<string, IUserOption>();

  for (const user of users) {
    // Запись доступа заведена на пару (telegramUserId, botId) — один и тот же
    // человек приходит несколькими строками, в списке он нужен один раз.
    if (options.has(user.telegramUserId)) continue;
    options.set(user.telegramUserId, { value: user.telegramUserId, label: sellerLabel(user) });
  }

  for (const row of rows) {
    if (!row.telegramUserId || options.has(row.telegramUserId)) continue;
    options.set(row.telegramUserId, {
      value: row.telegramUserId,
      label: logLabel(row),
      fromLog: true,
    });
  }

  // Выбранное значение остаётся в списке, даже если его нет ни там, ни там:
  // <select> с неизвестным значением показывает пустую строку, и фильтр
  // читался бы как «все», продолжая при этом фильтровать.
  if (selected && !options.has(selected)) {
    options.set(selected, { value: selected, label: selected, fromLog: true });
  }

  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

function sellerLabel(user: IUserRow): string {
  const name = displayName(user);
  const head = user.username && name !== user.username ? `${name} (@${user.username})` : name;
  return user.storeName ? `${head} — ${user.storeName}` : head;
}

/** Подпись по самой записи журнала: id показывается рядом — ник меняется, id нет. */
function logLabel(row: IActionLogRow): string {
  const who = row.username ? `@${row.username}` : row.name;
  return who ? `${who} — ${row.telegramUserId}` : row.telegramUserId;
}
