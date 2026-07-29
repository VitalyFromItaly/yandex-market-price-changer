import type { TAccessStatus } from '../../../../database/schemas/user-access.schema';

import { MENU_LABELS } from '../price-changer-bot/menu.constants';

/**
 * Чистая логика гейта доступа: без telegraf, без Mongo, без Nest.
 *
 * Вынесено сюда намеренно. Таблица «кому что можно» и формат callback_data —
 * ровно те места, где ошибка не даёт ни ошибки компиляции, ни падения в
 * рантайме: гейт просто начинает пускать не тех, а кнопка молча перестаёт
 * работать. Здесь их можно проверить обычными юнит-тестами.
 */

/** Сколько нельзя регистрироваться после отказа. */
export const REJECTION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Что за апдейт пришёл — с точки зрения права доступа. */
export type TUpdateKind =
  | 'start' // /start — единственное, что доступно всегда
  | 'credText' // свободный текст, кандидат в креды
  | 'menu' // нажата кнопка reply-клавиатуры
  | 'command' // любая другая слэш-команда
  | 'onboardingCallback' // inline-кнопка с инструкцией по настройке
  | 'callback' // любая другая inline-кнопка
  | 'other'; // документ, фото, стикер и прочее

/**
 * Inline-кнопки, которые нужны ДО одобрения: они лишь показывают инструкцию,
 * как получить креды, и ничего не делают с данными.
 */
export const ONBOARDING_CALLBACKS: readonly string[] = [
  'settings_api',
  'help_api_setup',
  // Сброс визарда — единственный способ прервать онбординг. Reply-кнопку сюда
  // добавить нельзя: её подпись попала бы в MENU_LABELS и потребовала бы hears.
  'onboarding_restart',
];

/**
 * Префиксы onboarding-колбэков, у которых в данных есть «хвост».
 *
 * Справка по шагу приходит как `onboarding_help:token` — сверять такие
 * точным равенством нельзя, иначе гейт не пропустит их на этапе регистрации,
 * то есть подсказка не откроется ровно тому, кому она нужна.
 */
export const ONBOARDING_CALLBACK_PREFIXES: readonly string[] = ['onboarding_help:'];

function isOnboardingCallback(data: string): boolean {
  return (
    ONBOARDING_CALLBACKS.includes(data) ||
    ONBOARDING_CALLBACK_PREFIXES.some((prefix) => data.startsWith(prefix))
  );
}

/**
 * Таблица допуска. Свежий пользователь может вводить креды — это и есть
 * регистрация; всё остальное закрыто до решения администратора.
 */
export function canPass(status: TAccessStatus, kind: TUpdateKind): boolean {
  if (kind === 'start') return true;
  switch (status) {
    case 'approved':
      return true;
    case 'new':
      return kind === 'credText' || kind === 'onboardingCallback';
    case 'pending':
    case 'rejected':
      return false;
    default:
      return false;
  }
}

/** Истёк ли суточный запрет. Без rejectedAt считаем, что истёк. */
export function isRejectionExpired(rejectedAt: Date | undefined, now: Date): boolean {
  if (!rejectedAt) return true;
  return now.getTime() - rejectedAt.getTime() >= REJECTION_COOLDOWN_MS;
}

/** Сколько часов осталось до конца запрета — для сообщения пользователю. */
export function hoursUntilRetry(rejectedAt: Date | undefined, now: Date): number {
  if (!rejectedAt) return 0;
  const left = rejectedAt.getTime() + REJECTION_COOLDOWN_MS - now.getTime();
  return left <= 0 ? 0 : Math.ceil(left / (60 * 60 * 1000));
}

/**
 * `/start`, `/start@ИмяБота`, `/start payload` — всё это одна и та же команда.
 * Проверять на равенство строке `/start` недостаточно: в группах и по
 * deep-link'у Telegram присылает расширенные формы.
 */
export function isStartCommand(text: string | undefined): boolean {
  return /^\/start(@\w+)?(\s|$)/.test(text ?? '');
}

export function isMenuLabel(text: string | undefined): boolean {
  return MENU_LABELS.includes(text as never);
}

/** Классификация апдейта по тексту и callback_data. */
export function classifyUpdate(input: {
  text?: string;
  callbackData?: string;
  hasDocument?: boolean;
}): TUpdateKind {
  if (input.callbackData !== undefined) {
    return isOnboardingCallback(input.callbackData) ? 'onboardingCallback' : 'callback';
  }
  const text = input.text;
  if (text === undefined) return 'other';
  if (isStartCommand(text)) return 'start';
  if (text.startsWith('/')) return 'command';
  if (isMenuLabel(text)) return 'menu';
  return 'credText';
}

// --- callback_data админских кнопок -----------------------------------------
//
// Формирование и разбор живут рядом, чтобы формат не разъехался между
// отправителем и получателем — та же причина, по которой появился
// menu.constants.ts. Лимит Telegram на callback_data — 64 байта.

export const ADMIN_CB_PREFIX = 'adm:';
export const ADMIN_CB_PATTERN = /^adm:(ap|rj):(\d{1,20})$/;

export type TAdminDecision = 'approve' | 'reject';

export function formatAdminCallback(
  decision: TAdminDecision,
  telegramUserId: string | number,
): string {
  return `${ADMIN_CB_PREFIX}${decision === 'approve' ? 'ap' : 'rj'}:${telegramUserId}`;
}

export function parseAdminCallback(
  data: string | undefined,
): { decision: TAdminDecision; telegramUserId: string } | null {
  const match = ADMIN_CB_PATTERN.exec(data ?? '');
  if (!match) return null;
  return {
    decision: match[1] === 'ap' ? 'approve' : 'reject',
    telegramUserId: match[2],
  };
}
