/**
 * Статьи финансового журнала — общие для всех площадок (ТЗ п.3).
 *
 * Лист без импортов: статьи нужны схеме базы, классификаторам площадок
 * (TASK-110 и дальше Ozon/WB) и экранам, и любой импорт отсюда в сторону
 * Nest или отчётов сделал бы цикл.
 *
 * Таблица — `Record<TFinanceArticle, …>`, а не массив: массив не заставляет
 * перечислить весь union, и новая статья без подписи прошла бы компиляцию
 * (довод DRAFT_FIELD_SET, TASK-052 за это уже платил).
 *
 * `unknown` — полноправная статья, а не «прочее»: операция, которую
 * классификатор не узнал, должна быть видна как нераспознанная, а не тонуть в
 * «прочих услугах», где прячутся подозрительные удержания.
 */

export type TFinanceArticle =
  | 'sales'
  | 'returns'
  | 'compensations'
  | 'subsidies'
  | 'other_income'
  | 'commission'
  | 'delivery_to_buyer'
  | 'reverse_logistics'
  | 'acquiring'
  | 'storage'
  | 'acceptance'
  | 'processing'
  | 'promotion'
  | 'paid_options'
  | 'penalties'
  | 'withholdings'
  | 'subscription'
  | 'other_services'
  | 'bonus_payment'
  | 'unknown';

/**
 * Где статья стоит в отчёте. Знак самой операции берётся из суммы, не отсюда.
 *
 * `reference` — справочные строки, которые не деньги (у ЯМ — услуги, оплаченные
 * бонусным балансом). Прибыль складывается из `income` и `expense`, поэтому
 * такая строка не попадает в неё по построению, а не по фильтру, который
 * каждый новый отчёт обязан помнить.
 */
export type TFinanceArticleGroup = 'income' | 'expense' | 'reference' | 'unknown';

export interface IFinanceArticleMeta {
  title: string;
  group: TFinanceArticleGroup;
}

export const FINANCE_ARTICLE_META: Record<TFinanceArticle, IFinanceArticleMeta> = {
  sales: { title: 'Продажи', group: 'income' },
  // Возвраты стоят в доходах со знаком минус: это сторно продажи, а не услуга.
  returns: { title: 'Возвраты', group: 'income' },
  compensations: { title: 'Компенсации', group: 'income' },
  subsidies: { title: 'Субсидии', group: 'income' },
  other_income: { title: 'Прочие начисления', group: 'income' },
  commission: { title: 'Комиссия', group: 'expense' },
  delivery_to_buyer: { title: 'Логистика до покупателя', group: 'expense' },
  reverse_logistics: { title: 'Обратная логистика', group: 'expense' },
  acquiring: { title: 'Эквайринг', group: 'expense' },
  storage: { title: 'Хранение', group: 'expense' },
  acceptance: { title: 'Приёмка', group: 'expense' },
  processing: { title: 'Обработка', group: 'expense' },
  promotion: { title: 'Продвижение', group: 'expense' },
  paid_options: { title: 'Платные опции', group: 'expense' },
  penalties: { title: 'Штрафы', group: 'expense' },
  withholdings: { title: 'Удержания', group: 'expense' },
  // Подписка Маркета и персональный менеджер — сводная строка акта ЯМ (TASK-155).
  // Подпись — «Абонентская плата», не «Подписка»: это слово в src сторожит
  // subscription-removed.test.ts (удалённая система подписок бота), а по смыслу
  // обе услуги — фиксированная плата за период.
  subscription: { title: 'Абонентская плата', group: 'expense' },
  other_services: { title: 'Прочие услуги', group: 'expense' },
  bonus_payment: { title: 'Оплачено баллами (справочно)', group: 'reference' },
  unknown: { title: 'Не распознано', group: 'unknown' },
};

export const FINANCE_ARTICLE_KEYS = Object.keys(FINANCE_ARTICLE_META) as TFinanceArticle[];

export function isFinanceArticle(value: unknown): value is TFinanceArticle {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(FINANCE_ARTICLE_META, value)
  );
}
