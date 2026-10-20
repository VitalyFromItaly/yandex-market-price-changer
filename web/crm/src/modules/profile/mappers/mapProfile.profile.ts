import type { Profile, ProfileFact, ProfileResponse } from '../profile.domain';

import { formatMoscowDate } from '@/shared/utils';

/**
 * Ответ → карточка фактов. Поля и подписи статуса — те же, что в «📊 Мой
 * профиль» бота (подпись доступа приходит с сервера готовой), плюс модель
 * размещения и дата прайса, которых бот не печатает.
 *
 * Регистрация без даты не печатается вовсе — как в боте: у админа записи
 * доступа нет, и «—» читалось бы как «не зарегистрирован».
 */
export function mapProfile(response: ProfileResponse): Profile {
  const facts: ProfileFact[] = [
    fact('Пользователь', response.name, '—'),
    fact('Telegram', response.username === null ? null : `@${response.username}`, 'ник не указан'),
    { label: 'Telegram ID', value: response.telegramUserId },
    { label: 'Доступ', value: response.access.label },
    storeFact(response.store),
    fact('Модель работы', response.store.placementType, 'неизвестна'),
  ];

  const registeredAt = dateOf(response.registeredAt);
  if (registeredAt !== null) facts.push({ label: 'Регистрация', value: registeredAt });

  facts.push(fact('Прайс загружен', dateOf(response.priceListUpdatedAt), 'ещё не загружали'));

  return { facts, features: response.features };
}

function fact(label: string, value: string | null, fallback: string): ProfileFact {
  return value === null || value === ''
    ? { label, value: fallback, muted: true }
    : { label, value };
}

function storeFact(store: ProfileResponse['store']): ProfileFact {
  if (!store.configured) return { label: 'Магазин', value: 'не подключён', muted: true };
  return fact('Магазин', store.name, 'подключён');
}

function dateOf(iso: string | null): string | null {
  return iso === null ? null : formatMoscowDate(iso);
}
