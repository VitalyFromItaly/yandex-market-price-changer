/**
 * Бренды закупа: кто есть в прайсе и по кому своя скидка.
 *
 * Здесь раньше было два захардкоженных случая — «Восток 4 %» и «всё остальное
 * 10 %» (VOSTOK_MARKERS в profit.ts). Скидка договаривается с поставщиком, то
 * есть с ЗАВОДОМ, поэтому единица настройки — бренд, а не категория прайса:
 * «ORIENT механические» и «ORIENT кварцевые» — один поставщик и одна скидка.
 *
 * Модуль-ЛИСТ без единого импорта, как telegram-html.ts: его тянут и profit.ts
 * (группировка при расчёте), и экраны бота (кнопки, подписи), и завести здесь
 * импорт из profit.ts значило бы цикл. Всё, чему нужны normalizeRate и дефолты
 * (цепочка фолбэков discountsOf), живёт в profit.ts рядом с ratesOf.
 */

/**
 * Ключ бренда — стабильный ASCII-слаг.
 *
 * Он уходит в callback_data (`bdisc:vostok`), в pendingRate (`brand:vostok`) и
 * в путь `$set` монги (`brandDiscounts.vostok`), поэтому кириллице и пробелам
 * здесь не место: callback_data ограничена 64 байтами, а точка или доллар в
 * ключе монги — это уже другой путь. Тест пинит формат `^[a-z0-9-]+$`.
 */
export type TBrandKey = 'vostok' | 'sever' | 'casio' | 'orient' | 'seiko' | 'daniel-klein';

interface IBrand {
  /** Название для кнопки и отчёта: «Восток», «CASIO». */
  title: string;
  /** Подстроки для поиска по `${категория} ${название}` в нижнем регистре. */
  markers: readonly string[];
  /**
   * Исключения — проверяются РАНЬШЕ markers, и совпадение выводит строку из
   * ЭТОГО бренда (а не из всех): «Восток Кремлёвские» не «Восток», но если бы
   * какая-то линейка совпала ещё и с другим брендом, она осталась бы его.
   */
  exclude?: readonly string[];
  /**
   * Подписи текстового ввода «скидка <подпись>: 5». Первая — та, что бот сам
   * предлагает в подсказках, остальные тоже принимаются.
   */
  inputLabels: readonly string[];
}

/**
 * Реестр брендов.
 *
 * `Record<TBrandKey, IBrand>`, а не массив-литерал — приём DRAFT_FIELD_SET:
 * Record обязывает компилятор потребовать каждый член объединения, массив
 * полноты не требует.
 *
 * Порядок ключей — это порядок МАТЧИНГА и порядок кнопок. `vostok` обязан быть
 * первым: его маркеры самые «широкие» (слово «восток» встречается и в названиях
 * линеек), и бренд, определённый позже, не должен перехватить востоковскую
 * строку.
 *
 * «Восток» — это Чистопольский часовой завод целиком: категории прайса
 * «Восток», «Командирские», «Партнер» плюс «Амфибия» в названиях (отдельной
 * категорией она не идёт). Один поставщик — одна договорённость по скидке.
 *
 * Исключения у «Востока» — решение заказчика: «Кремлёвские», «Брайлевские» и
 * «Мегаполис» идут по общей скидке, хотя завод тот же. В `stock.xlsx` есть
 * категория «Восток Кремлёвские» — по слову «Восток» она получила бы
 * востоковскую скидку, то есть ровно наоборот решению. Оба написания
 * «Кремлёвские»: в категории файла стоит «ё», в наименовании бывает «е».
 * «Мегаполис» исключён и у «Севера» — линейка не должна получить чужую скидку,
 * под каким бы брендом ни была подписана строка.
 */
const BRAND_SET: Record<TBrandKey, IBrand> = {
  vostok: {
    title: 'Восток',
    markers: ['восток', 'командирские', 'амфибия', 'партнер', 'партнёр'],
    exclude: ['кремлёвские', 'кремлевские', 'брайлевские', 'мегаполис'],
    inputLabels: ['восток', 'на восток', 'vostok'],
  },
  sever: {
    title: 'СЕВЕР',
    markers: ['север'],
    exclude: ['мегаполис'],
    inputLabels: ['север', 'sever'],
  },
  casio: {
    title: 'CASIO',
    markers: ['casio'],
    inputLabels: ['casio', 'касио'],
  },
  orient: {
    title: 'ORIENT',
    markers: ['orient'],
    inputLabels: ['orient', 'ориент'],
  },
  seiko: {
    title: 'SEIKO',
    markers: ['seiko'],
    inputLabels: ['seiko', 'сейко'],
  },
  'daniel-klein': {
    title: 'Daniel Klein',
    markers: ['daniel klein'],
    inputLabels: ['daniel klein', 'даниэль кляйн'],
  },
};

export const BRAND_KEYS = Object.keys(BRAND_SET) as TBrandKey[];

/** Является ли строка из базы или callback_data известным брендом. */
export function isBrandKey(value: unknown): value is TBrandKey {
  return typeof value === 'string' && BRAND_KEYS.includes(value as TBrandKey);
}

/** Название бренда для кнопки и отчёта. */
export function brandTitle(key: TBrandKey): string {
  return BRAND_SET[key].title;
}

/** Человеческое название скидки — для подтверждения и ошибки. */
export function brandDiscountTitle(key: TBrandKey): string {
  return `Скидка от прайса на «${BRAND_SET[key].title}»`;
}

/**
 * Подпись, которую бот предлагает для текстового ввода: «скидка восток: 4».
 *
 * ВЫВОДИТСЯ из inputLabels, а не пишется литералом рядом: подсказка обязана
 * быть подписью, которую парсер действительно принимает, — тот же принцип, что
 * у rateInputLabel.
 */
export function brandInputLabel(key: TBrandKey): string {
  return `скидка ${BRAND_SET[key].inputLabels[0]}`;
}

/**
 * Строка закупа в объёме, нужном для определения бренда. Структурно совместима
 * с IPurchaseRow из profit.ts; своя, чтобы модуль остался без импортов.
 */
export interface IBrandSource {
  name?: string;
  category?: string;
}

/**
 * Бренд позиции — или null, если позиция ничья и идёт по общей скидке.
 *
 * Определяется по сохранённым названию и категории, а не по отдельному полю в
 * базе: правило брендов живёт в коде, и его правка не должна требовать
 * перезагрузки прайса. Обобщение прежнего discountGroup из profit.ts — та же
 * склейка `${категория} ${название}` в нижнем регистре и тот же приём «частное
 * раньше общего», только исключения теперь свои у каждого бренда.
 */
export function brandOf(row: IBrandSource): TBrandKey | null {
  const haystack = `${row?.category ?? ''} ${row?.name ?? ''}`.toLowerCase();

  for (const key of BRAND_KEYS) {
    const brand = BRAND_SET[key];

    if (brand.exclude?.some((marker) => haystack.includes(marker))) continue;
    if (brand.markers.some((marker) => haystack.includes(marker))) return key;
  }

  return null;
}

// --- callback_data кнопок ----------------------------------------------------

/**
 * Формирование и разбор рядом — тем же приёмом, что у ставок (`rateCallback`):
 * формат не должен разъехаться между кнопкой и обработчиком.
 *
 * Самое длинное значение — `bdisc:daniel-klein`, 18 байт при лимите Telegram
 * в 64. Лимит держится на том, что ключи — ASCII-слаги; тест это пинит.
 */
export const BRAND_CB_PREFIX = 'bdisc:';

/** Открыть экран «Скидки по брендам». */
export const BRAND_CB_MENU = `${BRAND_CB_PREFIX}menu`;

/** Отмена вопроса «пришлите новое значение». */
export const BRAND_CB_CANCEL = `${BRAND_CB_PREFIX}cancel`;

export const BRAND_CB_PATTERN = new RegExp(
  `^${BRAND_CB_PREFIX}(${[...BRAND_KEYS, 'menu', 'cancel'].join('|')})$`,
);

export function brandCallback(key: TBrandKey): string {
  return `${BRAND_CB_PREFIX}${key}`;
}

/** Что нажали: бренд, экран целиком, отмену — или ничего из нашего. */
export function parseBrandCallback(data: string): TBrandKey | 'menu' | 'cancel' | null {
  const tail = BRAND_CB_PATTERN.exec(String(data ?? ''))?.[1];
  if (!tail) return null;
  if (tail === 'menu' || tail === 'cancel') return tail;
  return tail as TBrandKey;
}

// --- незакрытый вопрос «сколько процентов» -----------------------------------

/**
 * Вопрос о скидке бренда живёт в ТОМ ЖЕ поле UserAccess.pendingRate, что и
 * вопрос о ставке, с префиксом `brand:`. Это не то смешение, от которого
 * предостерегает история с «23» в pendingScheduleReport: там на одном поле
 * жили вопросы с РАЗНОЙ семантикой ответа (ставка и время), здесь оба ждут
 * голый процент с одной и той же валидацией — различается только, куда писать,
 * и это закодировано в самом значении.
 */
const BRAND_PENDING_PREFIX = 'brand:';

export function brandPendingValue(key: TBrandKey): string {
  return `${BRAND_PENDING_PREFIX}${key}`;
}

/**
 * Разбор сохранённого pendingRate: бренд или null (не брендовый вопрос).
 *
 * Легаси-литерал `vostokDiscountPercent` принимается как «Восток»: вопрос,
 * открытый до деплоя этой правки, должен разрешиться ответом, а не зависнуть —
 * ставки с таким именем больше нет, и isRateField его уже не пропустит.
 */
export function parseBrandPending(value: unknown): TBrandKey | null {
  if (typeof value !== 'string') return null;
  if (value === 'vostokDiscountPercent') return 'vostok';
  if (!value.startsWith(BRAND_PENDING_PREFIX)) return null;

  const tail = value.slice(BRAND_PENDING_PREFIX.length);
  return isBrandKey(tail) ? tail : null;
}

// --- текстовый ввод «скидка casio: 5» ----------------------------------------

/** Подпись → бренд. Порядок BRAND_KEYS, внутри бренда — порядок inputLabels. */
const INPUT_LABEL_MAP: Readonly<Record<string, TBrandKey>> = Object.fromEntries(
  BRAND_KEYS.flatMap((key) => BRAND_SET[key].inputLabels.map((label) => [label, key])),
);

export interface IBrandDiscountInput {
  brand: TBrandKey;
  value: number;
}

/**
 * Разбор сообщения вида «скидка восток: 4» или «скидка casio: 5».
 *
 * ОТДЕЛЬНЫЙ парсер, а не ветки в RATE_LABELS: подписи брендов приходят из
 * реестра, и держать их второй раз в карте ставок значило бы разъезд. Слово
 * «скидка» обязательно — оно и отличает брендовую скидку от прочих настроек.
 * Голая «скидка: 10» сюда НЕ попадает (нет подписи бренда) и уходит в
 * parseRateInput как общая скидка — «частное раньше общего» между двумя
 * парсерами обеспечивает вызывающий, разбирая брендовый первым.
 *
 * Число — по тем же правилам, что у ставок: десятые, запятая, необязательный %.
 */
export function parseBrandDiscountInput(text: string): IBrandDiscountInput | null {
  const match = String(text ?? '')
    .trim()
    .match(/^скидка\s+([А-Яа-яЁёA-Za-z]+(?:\s+[А-Яа-яЁёA-Za-z]+){0,2})\s*:\s*([\d.,]+)\s*%?$/i);
  if (!match) return null;

  const label = match[1].toLowerCase().replace(/\s+/g, ' ').trim();
  const brand = INPUT_LABEL_MAP[label];
  if (!brand) return null;

  const value = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(value)) return null;

  return { brand, value };
}
