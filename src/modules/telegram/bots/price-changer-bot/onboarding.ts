import type { TDraftField } from '../../../../database/services/user-access.service';

/**
 * Визард онбординга: три креда строго по одному за шаг.
 *
 * Зачем понадобился. Раньше тип креда УГАДЫВАЛСЯ по форме текста: длинная
 * строка — токен, число из 5–15 цифр — «не знаю, уточните сами». Пользователь
 * получал встречный вопрос вместо ответа, а любое непопадание в шаблон давало
 * «Не удалось определить тип данных». Причина была в отсутствии состояния: бот
 * не знал, что именно он спросил. Теперь знает — текущий шаг определяется
 * черновиком в UserAccess, и тип берётся из шага, а не из формы строки.
 *
 * Состояние намеренно НЕ в Redis с TTL (так предполагалось в снятой TASK-015):
 * одобрение асинхронное, администратор может решать часами, и протухший стейт
 * стёр бы уже собранные креды.
 */

/** Порядок шагов. Токен первый — он самый трудный, остальное подтягивается легко. */
export const ONBOARDING_STEPS: readonly TDraftField[] = [
  'token',
  'campaign_id',
  'business_id',
] as const;

export type TOnboardingDraft = Partial<Record<TDraftField, string>>;

/** Текущий шаг — первое незаполненное поле. `null` означает «всё собрано». */
export function nextStep(draft: TOnboardingDraft | undefined): TDraftField | null {
  return ONBOARDING_STEPS.find((field) => !draft?.[field]) ?? null;
}

export function stepNumber(step: TDraftField): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

export const ONBOARDING_TOTAL = ONBOARDING_STEPS.length;

/**
 * Скоуп токена — ТОЛЬКО на чтение. Бот ничего не меняет в магазине, а токен с
 * правом записи в чужих руках — это чужой прайс-лист.
 */
const TOKEN_PROMPT = [
  '🎫 <b>Шаг 1 из 3 — API-токен</b>',
  '',
  'В личном кабинете: «Настройки» → «API и веб-сервисы» → «Создать токен».',
  '',
  '⚠️ Скоуп выбирайте <b>только на чтение</b>:',
  '<code>inventory-and-order-processing:read-only</code>',
  'или <code>all-methods:read-only</code>.',
  'Права на запись боту не нужны — он ничего не меняет в вашем магазине.',
  '',
  'Пришлите токен одним сообщением.',
].join('\n');

const CAMPAIGN_PROMPT = [
  '🔑 <b>Шаг 2 из 3 — Campaign ID</b>',
  '',
  'Откройте partner.market.yandex.ru — число в адресе после <code>/campaigns/</code>',
  'и есть Campaign ID.',
  'Пример: <code>partner.market.yandex.ru/campaigns/12345678</code> → <code>12345678</code>',
  '',
  'Пришлите только число.',
].join('\n');

const BUSINESS_PROMPT = [
  '🏢 <b>Шаг 3 из 3 — Business ID</b>',
  '',
  'В личном кабинете: «Настройки» → «Общие настройки» → «ID бизнеса».',
  '',
  'Пришлите только число.',
].join('\n');

export function stepPrompt(step: TDraftField): string {
  switch (step) {
    case 'token':
      return TOKEN_PROMPT;
    case 'campaign_id':
      return CAMPAIGN_PROMPT;
    default:
      return BUSINESS_PROMPT;
  }
}

/** Человеческое название поля — для сообщений об ошибке. */
export function stepTitle(step: TDraftField): string {
  switch (step) {
    case 'token':
      return 'API-токен';
    case 'campaign_id':
      return 'Campaign ID';
    default:
      return 'Business ID';
  }
}

/**
 * Валидация значения конкретного шага. Ошибка формулируется в терминах того
 * поля, которое бот только что спросил, — а не «не удалось определить тип».
 */
export interface IStepValidation {
  ok: boolean;
  /** Заполнено только при ok === false. */
  error?: string;
}

export function validateStep(step: TDraftField, value: string): IStepValidation {
  const clean = value.trim();

  if (step === 'token') {
    if (clean.length < 10) {
      return { ok: false, error: 'Токен слишком короткий — в нём минимум 10 символов.' };
    }
    if (!/^[A-Za-z0-9_:.-]+$/.test(clean)) {
      return {
        ok: false,
        error:
          'В токене есть недопустимые символы. Скопируйте его целиком, без пробелов и переносов строк.',
      };
    }
    return { ok: true };
  }

  if (!/^\d{5,15}$/.test(clean)) {
    return {
      ok: false,
      error: `${stepTitle(step)} — это число из 5–15 цифр, без букв и пробелов.`,
    };
  }
  return { ok: true };
}

/**
 * Явно помеченное значение (`campaign_id: 12345`) принимается для НАЗВАННОГО
 * поля, даже если сейчас спрашивается другое. Это не догадка по форме строки —
 * тип назвал сам пользователь; ругаться на человека, аккуратно подписавшего
 * значение, было бы издевательством.
 */
export function parseLabelledValue(
  text: string,
): { field: TDraftField; value: string } | null {
  const match = text.match(/^(campaign_id|business_id|token)\s*:\s*(.+)$/is);
  if (!match) return null;
  return {
    field: match[1].toLowerCase() as TDraftField,
    value: match[2].trim(),
  };
}
