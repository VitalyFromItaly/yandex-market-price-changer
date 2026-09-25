/** Имена и пути маршрутов модуля — гвард и страницы ссылаются на них, а не на литералы. */
export const AUTH_ROUTE = {
  LOGIN: { name: 'login', path: '/login' },
  FORCE_PASSWORD: { name: 'force-password', path: '/password' },
} as const;

/** Куда попадает вошедший, если его никуда конкретно не звали. */
export const HOME_PATH = '/ym/stores';

/** Текст, с которым 401 выкидывает на вход, если сервер не прислал своего. */
export const SESSION_EXPIRED_TEXT = 'Сессия истекла, войдите заново';
