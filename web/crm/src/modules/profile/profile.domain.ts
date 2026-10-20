/**
 * «Профиль» CRM. Данные строит бэкенд той же функцией `profileView`, из
 * которой бот рисует «📊 Мой профиль», — здесь только форма ответа и вид.
 * Идентификаторов магазина и токена в ответе нет и быть не должно.
 */

export const PROFILE_ROUTE_NAME = 'profile';

export const PROFILE_TAB = { INFO: 'info', SECURITY: 'security' } as const;
export type ProfileTabKey = (typeof PROFILE_TAB)[keyof typeof PROFILE_TAB];

export interface ProfileTabMeta {
  key: ProfileTabKey;
  label: string;
}

/** Первая вкладка — по умолчанию, её ключа в URL нет (`/profile`, `/profile/security`). */
export const PROFILE_TABS: readonly ProfileTabMeta[] = [
  { key: PROFILE_TAB.INFO, label: 'Профиль' },
  { key: PROFILE_TAB.SECURITY, label: 'Безопасность' },
];

export interface ProfileFeature {
  key: string;
  label: string;
}

/** Ответ GET /profile. */
export interface ProfileResponse {
  telegramUserId: string;
  name: string | null;
  username: string | null;
  isAdmin: boolean;
  access: { status: string | null; label: string };
  registeredAt: string | null;
  store: { name: string | null; placementType: string | null; configured: boolean };
  priceListUpdatedAt: string | null;
  features: ProfileFeature[];
}

/** Строка карточки «ключ — значение». `muted` — значение-заглушка («не указан»). */
export interface ProfileFact {
  label: string;
  value: string;
  muted?: boolean;
}

export interface Profile {
  facts: ProfileFact[];
  features: ProfileFeature[];
}
