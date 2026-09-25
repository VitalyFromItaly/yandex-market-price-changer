import type {
  IProfileFeature,
  IProfileView,
} from '../../telegram/bots/price-changer-bot/profile.text';

/**
 * Ответ GET /api/crm/profile.
 *
 * Собирается ПЕРЕЧИСЛЕНИЕМ полей, а не раскладкой вьюхи или документа — тот же
 * довод, что у `/auth/me`: токен и идентификаторы кампании/бизнеса не должны
 * иметь пути в ответ даже по ошибке.
 */
export interface ICrmProfile {
  telegramUserId: string;
  name: string | null;
  username: string | null;
  isAdmin: boolean;
  access: { status: string | null; label: string };
  registeredAt: string | null;
  store: { name: string | null; placementType: string | null; configured: boolean };
  priceListUpdatedAt: string | null;
  features: IProfileFeature[];
}

export function toCrmProfile(view: IProfileView): ICrmProfile {
  const name = [view.firstName, view.lastName].filter(Boolean).join(' ').trim();

  return {
    telegramUserId: String(view.telegramUserId),
    name: name || null,
    username: view.username || null,
    isAdmin: view.isAdmin,
    access: { status: view.accessStatus ?? null, label: view.accessLabel },
    registeredAt: view.registeredAt ? view.registeredAt.toISOString() : null,
    store: {
      name: view.storeName || null,
      placementType: view.placementType ?? null,
      configured: view.configured,
    },
    priceListUpdatedAt: view.priceListUpdatedAt ? view.priceListUpdatedAt.toISOString() : null,
    features: (view.openFeatures ?? []).map(({ key, label }) => ({ key, label })),
  };
}
