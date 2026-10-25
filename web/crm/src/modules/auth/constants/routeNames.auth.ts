import { sectionPath } from '@/navigation.sections';

/** Имена и пути маршрутов модуля — гвард и страницы ссылаются на них, а не на литералы. */
export const AUTH_ROUTE = {
  LOGIN: { name: 'login', path: '/login' },
  FORCE_PASSWORD: { name: 'force-password', path: '/password' },
  /** Вход админа «за продавца» из админ-панели: токен приходит в ?token= адреса. */
  IMPERSONATE: { name: 'impersonate', path: '/impersonate' },
} as const;

/** Куда попадает вошедший, если его никуда конкретно не звали. */
export const HOME_PATH = sectionPath('ym', 'stores');

/**
 * Главная продавца без магазина ЯМ (только Ozon/WB, TASK-192): список магазинов
 * ЯМ ответил бы ему 409 NO_STORE, а «Подключения» открыты всем без фичи.
 */
export const NO_STORE_HOME_PATH = '/connections';

/** Текст, с которым 401 выкидывает на вход, если сервер не прислал своего. */
export const SESSION_EXPIRED_TEXT = 'Сессия истекла, войдите заново';
