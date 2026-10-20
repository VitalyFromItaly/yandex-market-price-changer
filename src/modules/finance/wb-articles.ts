/**
 * Классификатор статей отчёта реализации WB (reportDetailByPeriod, TASK-136) —
 * аналог `ozon-articles.ts`.
 *
 * Строка отчёта WB — не одна сумма, а набор денежных колонок: блок товара
 * (`retail_price_withdisc_rub`, `acquiring_fee`, `ppvz_for_pay`), логистика
 * (`delivery_rub`), хранение, штраф, удержание, приёмка, доплата. Поэтому
 * статья ставится каждой колонке, и строка ложится в журнал одной операцией
 * с расшифровкой (`breakdown`), как операция Ozon. Тип строки
 * (`supplier_oper_name`) решает, что значит блок товара: продажа и возврат
 * двигают товар, компенсация — нет.
 *
 * Сравнение — точное, как у ЯМ и Ozon: подстрочное «содержит Логистика»
 * отнесло бы новый тип к логистике молча. Незнакомое — `unknown`, и импорт
 * шлёт алерт. Перечень типов — по памяти: документация WB автоматике не
 * отдаётся (HTTP 498), на живом отчёте не сверен (known-gaps).
 *
 * Лист: импортирует только тип статьи.
 */

import type { TFinanceArticle } from './finance-articles';

/**
 * Типы строк с товаром: блок товара — выручка (знак — по `doc_type_name`),
 * эквайринг и комиссия, товар двигается.
 */
export const WB_GOODS_OPERS: ReadonlySet<string> = new Set([
  'Продажа',
  'Возврат',
  'Корректная продажа',
  'Корректный возврат',
  'Сторно продаж',
  'Сторно возвратов',
  'Коррекция продаж',
]);

/** Тип строки без товара → статья строки и её блока товара (если он не пуст). */
const BY_OPER: ReadonlyMap<string, TFinanceArticle> = new Map<string, TFinanceArticle>([
  ['Логистика', 'delivery_to_buyer'],
  ['Логистика сторно', 'delivery_to_buyer'],
  ['Коррекция логистики', 'delivery_to_buyer'],
  ['Возмещение издержек по перевозке', 'delivery_to_buyer'],
  ['Возмещение издержек по перевозке/по складским операциям с товаром', 'delivery_to_buyer'],
  ['Хранение', 'storage'],
  ['Штраф', 'penalties'],
  ['Штрафы', 'penalties'],
  ['Удержание', 'withholdings'],
  ['Удержания', 'withholdings'],
  ['Платная приемка', 'acceptance'],
  ['Платная приёмка', 'acceptance'],
  ['Компенсация ущерба', 'compensations'],
  ['Частичная компенсация брака', 'compensations'],
  ['Добровольная компенсация при возврате', 'compensations'],
  ['Компенсация подмененного товара', 'compensations'],
  ['Авансовая оплата за товар без движения', 'compensations'],
  ['Возмещение за выдачу и возврат товаров на ПВЗ', 'compensations'],
  ['Компенсация скидки по программе лояльности', 'compensations'],
]);

/** Все известные типы строк — для тестов «на каждый тип». */
export const WB_KNOWN_OPERS: readonly string[] = [...WB_GOODS_OPERS, ...BY_OPER.keys()];

/** Статья строки без товара по её типу; незнакомый — `unknown`. */
export function wbOperArticle(oper: string): TFinanceArticle {
  return BY_OPER.get(oper.trim()) ?? 'unknown';
}

/**
 * Колонки расходов и доплат → статья. Знак применяет разбор строки: расходы
 * вычитаются, `additional_payment` прибавляется. `delivery_rub` здесь нет —
 * его статья зависит от направления (`return_amount`).
 */
export const WB_COLUMN_ARTICLE = {
  storage_fee: 'storage',
  penalty: 'penalties',
  deduction: 'withholdings',
  acceptance: 'acceptance',
  additional_payment: 'compensations',
} as const satisfies Record<string, TFinanceArticle>;

/** Движение товара строкой WB — как `TOzonGoodsMovement`. */
export type TWbGoodsMovement = 'sold' | 'returned' | null;

/**
 * Двигает ли товар строка P&L операции WB. Строка — уже часть расшифровки,
 * поэтому товар двигает ТОЛЬКО часть выручки (довод `ozonGoodsMovement`):
 * комиссия и эквайринг той же строки несут тот же id.
 */
export function wbGoodsMovement(oper: string, article: TFinanceArticle): TWbGoodsMovement {
  if (!WB_GOODS_OPERS.has(oper.trim())) return null;
  if (article === 'sales') return 'sold';
  if (article === 'returns') return 'returned';
  return null;
}
