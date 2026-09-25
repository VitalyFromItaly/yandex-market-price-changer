/**
 * Чистая логика входа в CRM: без Nest, без Mongo, без bcrypt.
 *
 * Здесь решается, КОГО означает логин и годится ли новый пароль. Сверка
 * пароля и чтение базы — в CrmAuthService; разделение ради тестов без моков.
 */

/** Код 403, по которому фронт CRM показывает экран смены пароля. */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

/** 403 на входе: пароль верен, но в CRM этому человеку нельзя (решение crm_no_access_message). */
export const CRM_NO_ACCESS = 'CRM_NO_ACCESS';

/**
 * Коды ошибок формы смены пароля — по ним фронт ставит текст под нужное поле.
 * Код, а не сверка текста: формулировку можно править, не ломая форму.
 */
export const WRONG_CURRENT_PASSWORD = 'WRONG_CURRENT_PASSWORD';
export const WEAK_PASSWORD = 'WEAK_PASSWORD';

/** Аудитория CRM-токена. Админский токен её не несёт — и потому не проходит. */
export const CRM_AUDIENCE = 'crm';

/** Минимальная длина собственного пароля продавца. */
export const MIN_PASSWORD_LENGTH = 10;

/** Запись доступа в объёме, нужном для разбора логина. */
export interface ILoginRow {
  telegramUserId: string;
  status: string;
}

export type TAccountResolution<T extends ILoginRow> =
  | { kind: 'none' }
  | { kind: 'ambiguous' }
  | { kind: 'found'; telegramUserId: string; access: T | null };

/**
 * Логин как его ищем: без ведущей @ и без регистра.
 *
 * Регистр для ника не значим (Telegram считает «Vasya» и «vasya» одним ником),
 * а @ продавцы ставят по привычке — в базе ник лежит без неё. Нормализованный
 * логин заодно служит ключом ограничителя попыток, иначе «@Vasya» и «vasya»
 * давали бы по пять попыток каждый.
 */
export function normalizeLogin(login: string): string {
  return login.trim().replace(/^@+/, '').toLowerCase();
}

export function isNumericLogin(login: string): boolean {
  return /^\d+$/.test(login);
}

/**
 * Чья это учётка.
 *
 * - Числовой логин — это сам id, даже если записей доступа нет: у админов строки
 *   `UserAccess` нет вовсе, а пускать их решает вызывающий по TELEGRAM_ADMIN_IDS.
 * - Ник, найденный у РАЗНЫХ id, — неоднозначен: угадывать, чей это магазин,
 *   нельзя, продавцу подсказывается войти по id (решение crm_login).
 * - Несколько записей одного id (разные `botId`) — берётся одобренная: доступ
 *   решает она, а не случайная первая.
 */
export function resolveAccount<T extends ILoginRow>(
  rows: readonly T[],
  numericId?: string,
): TAccountResolution<T> {
  let telegramUserId = numericId;

  if (!telegramUserId) {
    const ids = [...new Set(rows.map((row) => row.telegramUserId))];
    if (ids.length === 0) return { kind: 'none' };
    if (ids.length > 1) return { kind: 'ambiguous' };
    telegramUserId = ids[0];
  }

  const own = rows.filter((row) => row.telegramUserId === telegramUserId);
  const access = own.find((row) => row.status === 'approved') ?? own[0] ?? null;

  return { kind: 'found', telegramUserId, access };
}

/**
 * Годится ли новый пароль. Возвращает текст отказа или null.
 *
 * Стартовый запрещён явно: его знает каждый продавец, и «сменить» на него же —
 * значит оставить магазин открытым всем, ради чего смена и обязательна.
 */
export function validateNewPassword(next: string, current: string, initial: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`;
  }
  if (next === initial) return 'Стартовый пароль нельзя оставить — придумайте свой';
  if (next === current) return 'Новый пароль совпадает с текущим';
  return null;
}
