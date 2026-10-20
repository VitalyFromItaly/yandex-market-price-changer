/**
 * Классификатор статей Яндекс.Маркета: строка журнала united-netting → статья
 * финансового журнала (`finance-articles.ts`).
 *
 * Лист: единственный импорт — тип статьи, он стирается при компиляции. Правила
 * нужны разбору журнала, будущим отчётам и скрипту сверки, и импорт отсюда в
 * сторону Nest или базы сделал бы цикл.
 *
 * Строки таблиц сняты с живого журнала кабинета 164225008 за 09-2026 (21 663
 * строки, решение `finance_ym_report_map`), а не из спецификации. Сопоставление
 * — точное (после нормализации регистра, пробелов и «ё»), без подстрок: тип,
 * которого здесь нет, уходит в `unknown` и алерт, а не угадывается. Молча
 * сваленное в «прочие услуги» спрятало бы именно подозрительные удержания.
 */

import type { TFinanceArticle } from './finance-articles';

type TRow = Record<string, unknown>;

export interface IYmClassification {
  article: TFinanceArticle;
  /**
   * Сторно услуги: Маркет вернул часть удержания («Скидка за лояльность»,
   * «Возврат за …»). Статья — та же услуга, знак суммы — «+», то есть расход
   * уменьшается, а дохода не появляется.
   */
  reversal: boolean;
  /**
   * Тип строки без id, сумм и названий товаров: «Начисление · Платёж
   * покупателя». Для алерта и отдельной строки «не распознано» в отчёте —
   * артикул сделал бы из одного незнакомого типа тысячу.
   */
  signature: string;
}

/** Регистр, лишние пробелы и «ё» у Маркета не должны рождать unknown. */
export function normalizeYmLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

const pair = (type: string, source: string) =>
  `${normalizeYmLabel(type)}|${normalizeYmLabel(source)}`;

const byLabel = (entries: ReadonlyArray<[string, TFinanceArticle]>) =>
  new Map(entries.map(([label, article]) => [normalizeYmLabel(label), article]));

/** Источник «Оплата услуг Маркета»: статью решает название услуги. */
const SERVICE_SOURCE = 'Оплата услуг Маркета';

/** Операции, статью которых решают тип и источник. */
const BY_TYPE_SOURCE = new Map<string, TFinanceArticle>(
  (
    [
      ['Начисление', 'Платёж покупателя', 'sales'],
      ['Начисление', 'Баллы за скидку Маркета', 'subsidies'],
      ['Начисление', 'Баллы за скидку Яндекс Плюс', 'subsidies'],
      // Возврат баллов — минус субсидия по возвращённому заказу, часть возврата.
      ['Возврат', 'Возврат платежа покупателя', 'returns'],
      ['Возврат', 'Возврат баллов за скидку Маркета', 'returns'],
      ['Возврат', 'Возврат баллов за скидку Яндекс Плюс', 'returns'],
      ['Начисление', 'Утрата или порча товаров в доставке', 'compensations'],
      ['Начисление', 'Утеря или порча отправления заказа', 'compensations'],
      ['Начисление', 'Ненадлежащее оказание услуг', 'compensations'],
      ['Начисление', 'Премия', 'other_income'],
      // Тип — «Возврат», а не «Удержание», как записано в карте TASK-108: так в журнале.
      ['Возврат', 'Удержание выплаты за утерю или порчу заказа', 'withholdings'],
      [
        'Возврат',
        'Выплата расходов покупателю при возврате товара ненадлежащего качества',
        'withholdings',
      ],
      // Услуги, оплаченные бонусным балансом совместных акций, — не деньги
      // («Справочно: списан с баланса»). В акт не входят: посчитать их расходом
      // значило бы удвоить услугу. Статья с группой `reference` в прибыль не идёт.
      ['Списание', 'Скидка за участие в совместных акциях', 'bonus_payment'],
      ['Возврат списания', 'Возврат скидки за участие в совместных акциях', 'bonus_payment'],
    ] as const
  ).map(([type, source, article]) => [pair(type, source), article]),
);

/** Удержание · Оплата услуг Маркета → статья по названию услуги. */
const WITHHELD_SERVICES = byLabel([
  ['Размещение товарных предложений', 'commission'],
  ['Доставка покупателю', 'delivery_to_buyer'],
  ['Доставка (средняя миля)', 'delivery_to_buyer'],
  ['Доставка невыкупов и возвратов', 'reverse_logistics'],
  ['Приём платежа', 'acquiring'],
  ['Перевод платежа', 'acquiring'],
  ['Буст продаж, оплата за продажи', 'promotion'],
  ['Отзывы за баллы', 'paid_options'],
]);

/** Начисление · Оплата услуг Маркета — сторно услуги, статья той же услуги. */
const REVERSED_SERVICES = byLabel([
  // Скидка за лояльность уменьшает плату за размещение (лист placement отчёта услуг).
  ['Скидка за лояльность', 'commission'],
  ['Возврат за размещение товаров на витрине', 'commission'],
  ['Возврат за доставку покупателю', 'delivery_to_buyer'],
  ['Возврат за доставку в населённый пункт или ФО покупателя', 'delivery_to_buyer'],
  // Живой импорт 10-2026: начисление по услуге, которая удержанием тоже delivery_to_buyer.
  ['Доставка (средняя миля)', 'delivery_to_buyer'],
]);

const WITHHELD = pair('Удержание', SERVICE_SOURCE);
const REVERSED = pair('Начисление', SERVICE_SOURCE);

const label = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value).trim();

const isBlank = (value: unknown) => value === null || value === undefined || value === '';

/**
 * Сводная строка акта — «Удержание · Оплата услуг Маркета» без названия услуги.
 * Тот же признак, что ветка `classifyYmRow`: импорт по нему решает, нужен ли
 * отчёт услуг для расшифровки (TASK-155).
 */
export function isYmActSummaryRow(row: TRow): boolean {
  const key = pair(String(row.transactionType ?? ''), String(row.transactionSource ?? ''));
  return key === WITHHELD && isBlank(row.offerOrServiceName);
}

/** Строка united-netting → статья. Незнакомое — `unknown`, никогда не «прочее». */
export function classifyYmRow(row: TRow): IYmClassification {
  const key = pair(String(row.transactionType ?? ''), String(row.transactionSource ?? ''));
  const typeSource = `${label(row.transactionType)} · ${label(row.transactionSource)}`;

  const direct = BY_TYPE_SOURCE.get(key);
  if (direct) return { article: direct, reversal: false, signature: typeSource };

  if (key !== WITHHELD && key !== REVERSED) {
    return { article: 'unknown', reversal: false, signature: typeSource };
  }

  // Только у услуг offerOrServiceName — название услуги, а не товара, и только
  // здесь оно входит в подпись.
  const service = row.offerOrServiceName;
  const signature = `${typeSource} · ${label(service)}`;
  const reversal = key === REVERSED;

  if (!reversal && isBlank(service)) {
    // Сводная строка акта: подписка, пуши, вывоз, обработка, хранение возвратов
    // одной суммой. Тип известен; расшифровать её можно только по отчёту услуг
    // (решение `finance_act_summary_other_services`) — это делает импорт полем
    // `breakdown` (TASK-155, `ym-act-breakdown.ts`), а статья строки остаётся
    // `other_services`: без отчёта услуг сумма честно лежит в «прочих».
    return { article: 'other_services', reversal: false, signature };
  }

  const table = reversal ? REVERSED_SERVICES : WITHHELD_SERVICES;
  const article = table.get(normalizeYmLabel(service));
  return article
    ? { article, reversal, signature }
    : { article: 'unknown', reversal: false, signature };
}

/** Движение товара строкой журнала: продан, вернулся или не двигался. */
export type TYmGoodsMovement = 'sold' | 'returned' | null;

const SOLD = pair('Начисление', 'Платёж покупателя');
const RETURNED = pair('Возврат', 'Возврат платежа покупателя');

/**
 * Двигает ли строка товар — вход себестоимости проданного (TASK-120).
 *
 * Только платёж покупателя и его возврат. Возврат баллов — тоже статья
 * `returns`, но это вторая строка ТОГО ЖЕ возврата: сторнируй мы по ней
 * себестоимость, вернувшийся товар вычелся бы дважды. Компенсация за утерю
 * товар не возвращает — его себестоимость остаётся расходом, а деньги приходят
 * своей статьёй дохода.
 */
export function ymGoodsMovement(
  transactionType: unknown,
  transactionSource: unknown,
): TYmGoodsMovement {
  const key = pair(String(transactionType ?? ''), String(transactionSource ?? ''));
  if (key === SOLD) return 'sold';
  if (key === RETURNED) return 'returned';
  return null;
}
