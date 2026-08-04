/**
 * Комиссия за продвижение: сколько Маркет берёт за буст продаж по брендам.
 *
 * Продвижение начисляется ЗА ТОВАР, поэтому единица настройки — бренд (свойство
 * товара), а не заказ. Настройка либо плоская («2 % с любой продажи бренда»),
 * либо ступенчатая от цены товара («до 10 000 ₽ — 2 %, свыше — 1 %») — границу
 * и оба процента продавец задаёт сам. Отсутствие настройки = 0 %: продвижение
 * подключают не все, и молчаливый дефолт «сколько-то процентов» завышал бы
 * расход тем, кто буст не покупал.
 *
 * Модуль импортирует ТОЛЬКО brands.ts (сам лист без импортов): его тянут
 * features.domain.ts (гейт колбэков `promo:` — обязан остаться чистым от Nest и
 * telegraf), profit.ts (расчёт), экраны бота и хендлер настроек. Импорт из
 * profit.ts здесь означал бы цикл — profit.ts импортирует расчёт ступени
 * отсюда. По той же причине границы процентов и форма валидации свои, а не
 * из profit.ts.
 */

import type { TBrandKey } from './brands';

import { BRAND_KEYS, brandTitle, isBrandKey } from './brands';

/**
 * Настройка продвижения одного бренда — дискриминированное объединение, не
 * пара «процент + необязательный порог»: у ступенчатой формы обязательны ВСЕ
 * три числа, и mode делает невозможным «порог есть, а второго процента нет».
 *
 * Граница включительно: цена, РАВНАЯ порогу, идёт по ставке `below` — «до
 * 10 000 ₽» читается как «10 000 ₽ ещё считается дешёвым». Тест пинит.
 */
export type TPromoConfig =
  | { mode: 'flat'; percent: number }
  | { mode: 'tiered'; limit: number; below: number; above: number };

/** Границы процентов — те же 0–100, что у ставок; 0 % — валидная явная ставка. */
const PROMO_MIN_PERCENT = 0;
const PROMO_MAX_PERCENT = 100;

function isPercent(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= PROMO_MIN_PERCENT &&
    value <= PROMO_MAX_PERCENT
  );
}

function isLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Карта настроек из сырого документа магазина — аналог discountsOf: ключ
 * проверяется через isBrandKey, мусорная запись (не тот mode, нечисло, процент
 * вне 0–100, порог ≤ 0) выкидывается ПО-ЗАПИСНО. Одна испорченная запись не
 * должна ронять весь отчёт «Прибыль» — остальные бренды считаются как настроены.
 */
export function promoConfigsOf(
  raw: Readonly<Record<string, unknown>> | null | undefined,
): Partial<Record<TBrandKey, TPromoConfig>> {
  const configs: Partial<Record<TBrandKey, TPromoConfig>> = {};

  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!isBrandKey(key)) continue;
    if (typeof value !== 'object' || value === null) continue;

    const entry = value as Record<string, unknown>;

    if (entry.mode === 'flat' && isPercent(entry.percent)) {
      configs[key] = { mode: 'flat', percent: entry.percent };
      continue;
    }

    if (
      entry.mode === 'tiered' &&
      isLimit(entry.limit) &&
      isPercent(entry.below) &&
      isPercent(entry.above)
    ) {
      configs[key] = {
        mode: 'tiered',
        limit: entry.limit,
        below: entry.below,
        above: entry.above,
      };
    }
  }

  return configs;
}

/**
 * Процент продвижения для товара данной цены. Цена — за ЕДИНИЦУ (item.price из
 * Partner API), не за строку заказа: «до 10 000 ₽» — про ценник товара, и две
 * штуки по 6 000 ₽ не должны перепрыгнуть порог только потому, что их две.
 */
export function promoPercentAt(config: TPromoConfig, price: number): number {
  if (config.mode === 'flat') return config.percent;
  return price <= config.limit ? config.below : config.above;
}

// --- подписи -----------------------------------------------------------------

/**
 * «10000» → «10\u00a0000\u00a0₽» — тем же способом, что formatRubles: toLocaleString
 * разделяет разряды НЕРАЗРЫВНЫМ пробелом, и NBSP перед ₽ записан
 * escape-последовательностью намеренно — невидимый символ в исходнике не
 * отличить от обычного пробела ни глазами, ни в диффе. Своя функция, а не
 * formatRubles, потому что порог не округляется до рубля: продавец ввёл его
 * сам и должен увидеть ровно то, что ввёл.
 */
export function promoLimitLabel(limit: number): string {
  return `${limit.toLocaleString('ru-RU')}\u00A0₽`;
}

/**
 * Полная подпись настройки — для текста экрана, подтверждения и хвоста отчёта:
 * «2%» | «до 10 000 ₽ — 2%, свыше — 1%» | «—» (не настроено).
 */
export function promoValueLabel(config: TPromoConfig | undefined): string {
  if (!config) return '—';
  if (config.mode === 'flat') return `${config.percent}%`;
  return `до ${promoLimitLabel(config.limit)} — ${config.below}%, свыше — ${config.above}%`;
}

/**
 * Короткая форма для кнопки: «2%» | «2/1%» | «—». В ряду из двух кнопок
 * Telegram обрезает длинные подписи — довод rateShortLabel; полная форма
 * печатается в тексте экрана строкой выше.
 */
export function promoShortValue(config: TPromoConfig | undefined): string {
  if (!config) return '—';
  if (config.mode === 'flat') return `${config.percent}%`;
  return `${config.below}/${config.above}%`;
}

/** Название настройки для подтверждений и ошибок: «Продвижение «CASIO»». */
export function promoTitle(key: TBrandKey): string {
  return `Продвижение «${brandTitle(key)}»`;
}

/**
 * Название вводимого процента — уходит в validatePercent, поэтому обязано
 * называть именно ту ступень, про которую задан вопрос: ошибка «должен быть от
 * 0 до 100» без этого не говорила бы, какой из двух процентов не принят.
 */
export function promoPercentTitle(key: TBrandKey, step: 'flat' | 'below' | 'above'): string {
  if (step === 'flat') return promoTitle(key);
  if (step === 'below') return `${promoTitle(key)} — процент до порога`;
  return `${promoTitle(key)} — процент свыше порога`;
}

// --- callback_data кнопок ----------------------------------------------------

/**
 * Формирование и разбор рядом — приём rateCallback/brandCallback: формат не
 * должен разъехаться между кнопкой и обработчиком.
 *
 * Самое длинное значение — `promo:pick:daniel-klein`, 23 байта при лимите
 * Telegram в 64. Держится на том, что ключи брендов — ASCII-слаги; тест пинит.
 */
export const PROMO_CB_PREFIX = 'promo:';

/** Открыть экран «Продвижение». */
export const PROMO_CB_MENU = `${PROMO_CB_PREFIX}menu`;

/** Отмена открытого вопроса — возврат на экран продвижения. */
export const PROMO_CB_CANCEL = `${PROMO_CB_PREFIX}cancel`;

/** Действия с брендом: выбрать, задать плоский процент, ступени, отключить. */
const PROMO_ACTIONS = ['pick', 'flat', 'tier', 'off'] as const;

type TPromoAction = (typeof PROMO_ACTIONS)[number];

export const PROMO_CB_PATTERN = new RegExp(
  `^${PROMO_CB_PREFIX}(?:menu|cancel|(?:${PROMO_ACTIONS.join('|')}):(?:${BRAND_KEYS.join('|')}))$`,
);

export function promoCallback(action: TPromoAction, key: TBrandKey): string {
  return `${PROMO_CB_PREFIX}${action}:${key}`;
}

export type TPromoCallback =
  | { kind: 'menu' }
  | { kind: 'cancel' }
  | { kind: TPromoAction; brand: TBrandKey };

/** Что нажали — или null, если callback_data не наша. */
export function parsePromoCallback(data: unknown): TPromoCallback | null {
  const value = String(data ?? '');
  if (!PROMO_CB_PATTERN.test(value)) return null;

  const tail = value.slice(PROMO_CB_PREFIX.length);
  if (tail === 'menu' || tail === 'cancel') return { kind: tail };

  const [action, brand] = tail.split(':');
  // Паттерн уже гарантировал и действие, и бренд — разбор не может не сойтись.
  return { kind: action as TPromoAction, brand: brand as TBrandKey };
}

// --- незакрытый вопрос: пошаговый ввод ---------------------------------------

/**
 * Пошаговая цепочка живёт в ТОМ ЖЕ поле UserAccess.pendingRate, что и вопросы
 * о ставках и брендовых скидках, — и промежуточные ответы кодируются В САМОЙ
 * строке, а не пишутся в Mongo по одному:
 *
 *   promo:<key>:flat              → ответ: процент       → запись {flat}
 *   promo:<key>:limit             → ответ: порог X       → promo:<key>:below:<X>
 *   promo:<key>:below:<X>         → ответ: процент A     → promo:<key>:above:<X>:<A>
 *   promo:<key>:above:<X>:<A>     → ответ: процент B     → запись {tiered}
 *
 * В документ магазина уходит ОДИН $set в самом конце: недоотвеченная цепочка
 * не должна оставлять полузаполненную настройку, по которой отчёт что-то
 * насчитает. Брошенный на полпути вопрос стоит ровно ничего — pendingRate
 * перезаписывается следующим вопросом или снимается отменой.
 *
 * Префикс совпадает с callback-кодеком нарочно (это одна фича), а формы не
 * пересекаются: вторым сегментом здесь всегда ключ бренда, там — действие.
 */
export type TPromoPending =
  | { brand: TBrandKey; step: 'flat' }
  | { brand: TBrandKey; step: 'limit' }
  | { brand: TBrandKey; step: 'below'; limit: number }
  | { brand: TBrandKey; step: 'above'; limit: number; below: number };

export function promoPendingFlat(key: TBrandKey): string {
  return `${PROMO_CB_PREFIX}${key}:flat`;
}

export function promoPendingLimit(key: TBrandKey): string {
  return `${PROMO_CB_PREFIX}${key}:limit`;
}

export function promoPendingBelow(key: TBrandKey, limit: number): string {
  return `${PROMO_CB_PREFIX}${key}:below:${String(limit)}`;
}

export function promoPendingAbove(key: TBrandKey, limit: number, below: number): string {
  return `${PROMO_CB_PREFIX}${key}:above:${String(limit)}:${String(below)}`;
}

/**
 * Разбор сохранённого pendingRate — или null (не промо-вопрос). Числовые
 * хвосты обязаны быть конечными числами в допустимых границах: строка приходит
 * из базы, и испорченное значение должно закрыть вопрос, а не дожить до $set.
 */
export function parsePromoPending(value: unknown): TPromoPending | null {
  if (typeof value !== 'string' || !value.startsWith(PROMO_CB_PREFIX)) return null;

  const parts = value.slice(PROMO_CB_PREFIX.length).split(':');
  const brand = parts[0];
  if (!isBrandKey(brand)) return null;

  const step = parts[1];
  if (step === 'flat' && parts.length === 2) return { brand, step };
  if (step === 'limit' && parts.length === 2) return { brand, step };

  if (step === 'below' && parts.length === 3) {
    const limit = Number(parts[2]);
    return isLimit(limit) ? { brand, step, limit } : null;
  }

  if (step === 'above' && parts.length === 4) {
    const limit = Number(parts[2]);
    const below = Number(parts[3]);
    return isLimit(limit) && isPercent(below) ? { brand, step, limit, below } : null;
  }

  return null;
}

// --- ввод порога -------------------------------------------------------------

/**
 * Разбор ответа на вопрос о пороге: «10000», «10 000», «10 000 ₽» — рубли,
 * пробелы-разделители и знак валюты принимаются, потому что именно так сумму
 * пишут руками. Дата («28-07-2026») и время («09:00») не матчатся — дефис и
 * двоеточие в паттерне не разрешены, поэтому открытый промо-вопрос не
 * перехватывает ответы вопросам о дне отчёта и времени рассылки.
 */
export function parsePromoLimit(text: string): number | null {
  const match = String(text ?? '')
    .trim()
    .match(/^([\d\s ]+(?:[.,]\d+)?)\s*₽?$/);
  if (!match) return null;

  const value = Number(match[1].replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export interface IPromoValidation {
  ok: boolean;
  error?: string;
}

/** Порог должен быть больше нуля — «до 0 ₽» не описывает ни один товар. */
export function validatePromoLimit(value: number): IPromoValidation {
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Порог должен быть числом больше нуля — например 10000.' };
  }
  return { ok: true };
}
