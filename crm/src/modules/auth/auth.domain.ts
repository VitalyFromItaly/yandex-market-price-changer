/**
 * Вход в CRM: сессия, профиль вошедшего, формы. Зеркало ответов
 * /api/crm/auth/* (src/modules/crm/crm-auth.service.ts).
 */

/** Ответ /auth/login и /auth/password. */
export interface SessionResponse {
  token: string;
  mustChangePassword: boolean;
}

/** Ответ /auth/me. Идентификаторов магазина и токена Маркета в нём нет — и не должно быть. */
export interface MeResponse {
  telegramUserId: string;
  name: string;
  username: string | null;
  isAdmin: boolean;
  mustChangePassword: boolean;
  store: { name: string; placementType: string | null } | null;
  features: Record<string, boolean>;
  /** Разделы навигации (имена маршрутов), которые показать: закрытые фичей в ответ не попадают. */
  sections: string[];
}

export interface Me {
  telegramUserId: string;
  /** null — имени в Telegram нет. */
  name: string | null;
  username: string | null;
  isAdmin: boolean;
  mustChangePassword: boolean;
  store: { name: string; placementType: string | null } | null;
  features: Record<string, boolean>;
  /** Разделы навигации (имена маршрутов), которые показать: закрытые фичей в ответ не попадают. */
  sections: string[];
}

export interface LoginForm {
  login: string;
  password: string;
}

export interface PasswordForm {
  current: string;
  next: string;
  repeat: string;
}

export type PasswordField = keyof PasswordForm;

/** Ошибки формы смены пароля по полям; `form` — то, что не относится ни к одному полю. */
export type PasswordErrors = Partial<Record<PasswordField | 'form', string>>;

/** Минимальная длина — та же, что проверяет сервер (MIN_PASSWORD_LENGTH в crm-auth.domain.ts). */
export const MIN_PASSWORD_LENGTH = 10;

/** Машинные коды ошибок сервера, на которые фронт реагирует по-своему. */
export const AUTH_ERROR_CODE = {
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  NO_ACCESS: 'CRM_NO_ACCESS',
  WRONG_CURRENT_PASSWORD: 'WRONG_CURRENT_PASSWORD',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
} as const;
