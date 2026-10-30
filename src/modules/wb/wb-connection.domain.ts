import type { TWbCategory } from './wb.client';

/**
 * Проверка ФОРМЫ токена WB до похода в WB и правило категорий — чистые, без Nest.
 *
 * Токен WB — JWT (три base64url-сегмента через точку): на другое WB отвечает
 * 401 «token contains an invalid number of segments» (живой запрос 18-10-2026),
 * и продавец получил бы «токен не принят» вместо подсказки под полем. Подпись
 * не проверяется — это дело WB; из полезной нагрузки берётся только срок `exp`,
 * чтобы истёкший токен получил свой текст, а не общий отказ.
 */

/**
 * Категории, без которых подключение бесполезно (TASK-133): товары и остатки
 * (контент, маркетплейс), заказы и продажи (статистика, аналитика), отчёт
 * реализации (финансы). Порядок — порядок перечисления продавцу.
 *
 * «Цены и скидки» сюда не входит (решение `price_set_wb_prices_scope`): без неё
 * у продавца работает всё, кроме «Установки цен», а её право проверяет сам
 * `WbPriceWriteService` — понятным текстом, без падения подключения.
 */
export const WB_REQUIRED_CATEGORIES: readonly TWbCategory[] = [
  'content',
  'marketplace',
  'statistics',
  'analytics',
  'finance',
];

/** Названия категорий так, как они подписаны в кабинете WB при выпуске токена. */
export const WB_CATEGORY_LABEL: Record<TWbCategory, string> = {
  content: 'Контент',
  analytics: 'Аналитика',
  prices: 'Цены и скидки',
  marketplace: 'Маркетплейс',
  statistics: 'Статистика',
  promotion: 'Продвижение',
  feedbacks: 'Вопросы и отзывы',
  finance: 'Финансы',
  documents: 'Документы',
};

export const WB_TOKEN_FORMAT_TEXT =
  'Это не похоже на токен WB API: он длинный, из трёх частей через точку. Скопируйте его целиком ' +
  'из личного кабинета WB (Настройки → Доступ к API).';

export const WB_TOKEN_EXPIRED_TEXT =
  'Срок действия токена истёк. Выпустите новый в личном кабинете WB (Настройки → Доступ к API).';

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MIN_LENGTH = 40;
const MAX_LENGTH = 4096;

export type TWbTokenParse = { ok: true; token: string } | { ok: false; message: string };

export function parseWbToken(body: unknown, now: Date = new Date()): TWbTokenParse {
  const input = (body ?? {}) as { token?: unknown };
  const token = typeof input.token === 'string' ? input.token.trim() : '';

  if (token.length < MIN_LENGTH || token.length > MAX_LENGTH || !JWT.test(token)) {
    return { ok: false, message: WB_TOKEN_FORMAT_TEXT };
  }
  const exp = expiryOf(token);
  if (exp !== null && exp.getTime() <= now.getTime()) {
    return { ok: false, message: WB_TOKEN_EXPIRED_TEXT };
  }
  return { ok: true, token };
}

/** `exp` из полезной нагрузки JWT; нечитаемое — null: решит сам WB. */
export function expiryOf(token: string): Date | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? new Date(payload.exp * 1000)
      : null;
  } catch {
    return null;
  }
}

/** Текст отказа «не хватает категорий» — с перечнем, чтобы продавец перевыпустил токен один раз. */
export function missingCategoriesText(missing: readonly TWbCategory[]): string {
  const names = missing.map((category) => `«${WB_CATEGORY_LABEL[category]}»`).join(', ');
  return (
    `У токена нет доступа к категориям: ${names}. Выпустите токен заново в личном кабинете WB ` +
    '(Настройки → Доступ к API) и отметьте их.'
  );
}
