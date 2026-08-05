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
 * пара «процент + необязательный порог ступени»: у ступенчатой формы
 * обязательны ВСЕ три числа, и mode делает невозможным «порог есть, а второго
 * процента нет». `from` — другое дело: нижний порог, цена, с которой
 * продвижение вообще начисляется (дешевле — 0%). Его отсутствие — полноценное
 * состояние («с первого рубля»), и осмыслен он при любом режиме, поэтому это
 * независимое необязательное поле, а не фрагмент режима.
 *
 * Обе границы включительно: цена, РАВНАЯ `limit`, идёт по ставке `below`
 * («до 10 000 ₽» читается как «10 000 ₽ ещё считается дешёвым»), цена, РАВНАЯ
 * `from`, уже продвигается («от 3 000 ₽» — «3 000 ₽ уже считается»). Тесты
 * пинят обе.
 */
export type TPromoConfig =
  | { mode: 'flat'; percent: number; from?: number }
  | { mode: 'tiered'; limit: number; below: number; above: number; from?: number };

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
 * Нижний порог, в отличие от границы ступени, допускает ноль: «0» — это ответ
 * «порога нет». В базу такой ноль не попадает (promoWithFloor его не пишет), но
 * в строке незакрытого вопроса он живёт как обычное значение.
 */
function isFloor(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Карта настроек из сырого документа магазина — аналог discountsOf: ключ
 * проверяется через isBrandKey, мусорная запись (не тот mode, нечисло, процент
 * вне 0–100, порог ≤ 0) выкидывается ПО-ЗАПИСНО. Одна испорченная запись не
 * должна ронять весь отчёт «Прибыль» — остальные бренды считаются как настроены.
 *
 * Мусорный `from` тоже роняет запись ЦЕЛИКОМ, а не отбрасывается молча:
 * сохранённый порог — заявление продавца «дешевле не продвигается», и считать
 * без него значило бы незаметно занижать прибыль; «—» на экране — видимая
 * поломка, чинится в два тапа. `from: 0` в базе — тоже мусор: путь записи ноль
 * не сохраняет (ноль убирает ключ).
 */
export function promoConfigsOf(
  raw: Readonly<Record<string, unknown>> | null | undefined,
): Partial<Record<TBrandKey, TPromoConfig>> {
  const configs: Partial<Record<TBrandKey, TPromoConfig>> = {};

  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!isBrandKey(key)) continue;
    if (typeof value !== 'object' || value === null) continue;

    const entry = value as Record<string, unknown>;

    if (entry.from !== undefined && !isLimit(entry.from)) continue;
    // Условный спред: ключ `from: undefined` не должен появляться в результате —
    // toStrictEqual его видит, и в $set он бы уехал как есть. Проверка повторная
    // ради сужения типа: отрицание составного условия его не даёт.
    const from = isLimit(entry.from) ? { from: entry.from } : {};

    if (entry.mode === 'flat' && isPercent(entry.percent)) {
      configs[key] = { mode: 'flat', percent: entry.percent, ...from };
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
        ...from,
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
  // Нижний порог проверяется ПЕРВЫМ, до ступеней: при from > limit это даёт
  // когерентное «дешевле from — 0, дальше по ступеням», а не кашу. Тест пинит.
  if (config.from !== undefined && price < config.from) return 0;
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
 * «2%» | «до 10 000 ₽ — 2%, свыше — 1%» | «—» (не настроено). Нижний порог —
 * префиксом: «от 3 000 ₽: 2%».
 */
export function promoValueLabel(config: TPromoConfig | undefined): string {
  if (!config) return '—';
  const prefix = config.from !== undefined ? `от ${promoLimitLabel(config.from)}: ` : '';
  if (config.mode === 'flat') return `${prefix}${config.percent}%`;
  return `${prefix}до ${promoLimitLabel(config.limit)} — ${config.below}%, свыше — ${config.above}%`;
}

/**
 * Короткая форма для кнопки: «2%» | «2/1%» | «—». В ряду из двух кнопок
 * Telegram обрезает длинные подписи — довод rateShortLabel; полная форма
 * печатается в тексте экрана строкой выше. Нижний порог здесь не показывается
 * намеренно — как не показывается и лимит ступеней.
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
 * Самое длинное значение — `promo:floor:daniel-klein`, 24 байта при лимите
 * Telegram в 64. Держится на том, что ключи брендов — ASCII-слаги; тест пинит.
 */
export const PROMO_CB_PREFIX = 'promo:';

/** Открыть экран «Продвижение». */
export const PROMO_CB_MENU = `${PROMO_CB_PREFIX}menu`;

/** Отмена открытого вопроса — возврат на экран продвижения. */
export const PROMO_CB_CANCEL = `${PROMO_CB_PREFIX}cancel`;

/**
 * Действия с брендом: выбрать, задать плоский процент, ступени, отключить.
 *
 * `floor` — ЛЕГАСИ: кнопка «📏 Нижний порог» была отдельной ровно один релиз, и
 * порог за ней не задавался никогда (она показывалась только у уже настроенного
 * бренда, поэтому продавец проходил настройку целиком и про порог не узнавал).
 * Теперь порог — первый вопрос обеих цепочек, а действие остаётся: inline-кнопка
 * живёт в истории чата вечно, и без него она упала бы в default-ветку общего
 * callback_query с «Неизвестной командой» — довод `rate:vostokDiscountPercent`.
 */
const PROMO_ACTIONS = ['pick', 'flat', 'tier', 'off', 'floor'] as const;

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
 *   promo:<key>:from:flat          → ответ: порог F     → promo:<key>:flat:<F>
 *   promo:<key>:flat:<F>           → ответ: процент P   → запись {flat}
 *
 *   promo:<key>:from:tier          → ответ: порог F     → promo:<key>:limit:<F>
 *   promo:<key>:limit:<F>          → ответ: граница X   → promo:<key>:below:<F>:<X>
 *   promo:<key>:below:<F>:<X>      → ответ: процент A   → promo:<key>:above:<F>:<X>:<A>
 *   promo:<key>:above:<F>:<X>:<A>  → ответ: процент B   → запись {tiered}
 *
 * НИЖНИЙ ПОРОГ — первый вопрос ОБЕИХ цепочек, а не отдельная кнопка. Кнопкой он
 * был ровно один релиз и не задавался никогда: она показывалась только у уже
 * настроенного бренда, так что продавец проходил настройку целиком и про порог
 * не узнавал. Ответ «0» означает «порога нет» и в документ не попадает вовсе
 * (promoWithFloor) — хранимый `from: 0` promoConfigsOf считает мусором.
 *
 * ЛЕГАСИ: формы без ведущего F (`promo:<key>:flat`, `:limit`, `:below:<X>`,
 * `:above:<X>:<A>`) — вопросы, открытые до этого релиза; читаются как «порога
 * нет», то есть ровно с той семантикой, что была в момент вопроса. Каждая ровно
 * на один сегмент короче актуальной формы того же шага — отсюда табличный
 * разбор ниже. Вернуть на них null было бы хуже, чем «вопрос потерян»: pendingRate
 * остался бы висеть в базе, а числовой ответ уехал бы в визард с «Не понял, что
 * именно нужно изменить».
 *
 * В документ магазина уходит ОДИН $set в самом конце: недоотвеченная цепочка
 * не должна оставлять полузаполненную настройку, по которой отчёт что-то
 * насчитает. Брошенный на полпути вопрос стоит ровно ничего — pendingRate
 * перезаписывается следующим вопросом или снимается отменой.
 *
 * Префикс совпадает с callback-кодеком нарочно (это одна фича), а формы не
 * пересекаются: вторым сегментом здесь всегда ключ бренда, там — действие.
 */
export type TPromoMode = 'flat' | 'tier';

export type TPromoPending =
  | { brand: TBrandKey; step: 'from'; mode: TPromoMode }
  | { brand: TBrandKey; step: 'flat'; from: number }
  | { brand: TBrandKey; step: 'limit'; from: number }
  | { brand: TBrandKey; step: 'below'; from: number; limit: number }
  | { brand: TBrandKey; step: 'above'; from: number; limit: number; below: number };

/**
 * Один кодер на все шаги — не пять функций: дескриптор шага и его строка обязаны
 * меняться вместе, а разъехаться они могут только если их можно править порознь.
 */
export function promoPendingValue(pending: TPromoPending): string {
  const head = `${PROMO_CB_PREFIX}${pending.brand}:${pending.step}`;

  switch (pending.step) {
    case 'from':
      return `${head}:${pending.mode}`;
    case 'flat':
    case 'limit':
      return `${head}:${String(pending.from)}`;
    case 'below':
      return `${head}:${String(pending.from)}:${String(pending.limit)}`;
    case 'above':
      return `${head}:${String(pending.from)}:${String(pending.limit)}:${String(pending.below)}`;
  }
}

/** Сколько чисел в хвосте у актуальной формы шага; легаси-форма — на одно короче. */
const PROMO_TAIL_ARITY = { flat: 1, limit: 1, below: 2, above: 3 } as const;

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

  // Первый шаг обеих цепочек: режим ещё не выражен числом и едет отдельным
  // сегментом. Голый `promo:<key>:from` — форма кнопочной итерации, не вопрос.
  if (step === 'from') {
    if (parts.length !== 3) return null;
    const mode = parts[2];
    return mode === 'flat' || mode === 'tier' ? { brand, step, mode } : null;
  }

  if (step !== 'flat' && step !== 'limit' && step !== 'below' && step !== 'above') return null;

  // Number('') === 0, поэтому пустой сегмент обязан стать мусором явно — иначе
  // «promo:casio:flat:» разобралось бы как валидный нулевой порог.
  const tail = parts.slice(2).map((part) => (part === '' ? Number.NaN : Number(part)));
  const arity = PROMO_TAIL_ARITY[step];

  const numbers =
    // eslint-disable-next-line no-nested-ternary
    tail.length === arity ? tail : tail.length === arity - 1 ? [0, ...tail] : null;
  if (numbers === null) return null;

  const [from, limit, below] = numbers;
  if (!isFloor(from)) return null;

  switch (step) {
    case 'flat':
    case 'limit':
      return { brand, step, from };
    case 'below':
      return isLimit(limit) ? { brand, step, from, limit } : null;
    case 'above':
      return isLimit(limit) && isPercent(below) ? { brand, step, from, limit, below } : null;
  }
}

/**
 * Порядок вопросов каждой цепочки. Нумерация «Шаг N из M» берётся ТОЛЬКО
 * отсюда: литералами в хендлере она уже разъезжалась (после добавления порога
 * там осталось «Шаг 1 из 3» на цепочке из четырёх шагов).
 */
const PROMO_CHAIN = {
  flat: ['from', 'flat'],
  tier: ['from', 'limit', 'below', 'above'],
} as const;

/** «Шаг 2 из 4.» — по дескриптору шага, а не по литералу рядом с текстом. */
export function promoStepTitle(pending: TPromoPending): string {
  const chain: readonly string[] =
    pending.step === 'from' ? PROMO_CHAIN[pending.mode] : PROMO_CHAIN[promoModeOf(pending.step)];

  return `Шаг ${chain.indexOf(pending.step) + 1} из ${chain.length}.`;
}

function promoModeOf(step: Exclude<TPromoPending['step'], 'from'>): TPromoMode {
  return step === 'flat' ? 'flat' : 'tier';
}

/**
 * Дописать нижний порог в готовую настройку. Ноль — «порога нет»: ключ не
 * пишется вовсе, потому что хранимый `from: 0` promoConfigsOf считает мусором и
 * выкидывает запись целиком. То есть ноль обязан исчезнуть на пути записи, а не
 * быть сохранён «как есть».
 */
export function promoWithFloor(config: TPromoConfig, from: number): TPromoConfig {
  return from > 0 ? { ...config, from } : config;
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

/**
 * Нижний порог, в отличие от границы ступени, принимает и ноль: «0» — это ответ
 * «порога нет», один вопрос обслуживает и установку, и отказ от порога.
 */
export function validatePromoFrom(value: number): IPromoValidation {
  if (!isFloor(value)) {
    return {
      ok: false,
      error:
        'Нижний порог должен быть числом не меньше нуля — например 3000. ' +
        'Пришлите 0, если порога нет.',
    };
  }
  return { ok: true };
}
