import type { Me, MeResponse } from '../auth.domain';

/** Ответ /auth/me → профиль. Пустое имя — «неизвестно», а не пустая строка на экране. */
export function mapMe(response: MeResponse): Me {
  const name = response.name.trim();
  return {
    telegramUserId: response.telegramUserId,
    name: name.length > 0 ? name : null,
    username: response.username,
    isAdmin: response.isAdmin,
    mustChangePassword: response.mustChangePassword,
    store: response.store,
    features: response.features,
    sections: response.sections,
  };
}

/** Как назвать вошедшего в сайдбаре: имя, иначе @ник, иначе id. */
export function displayNameOf(me: Me): string {
  if (me.name !== null) return me.name;
  if (me.username !== null) return `@${me.username}`;
  return me.telegramUserId;
}
