import type { TFinanceArticle } from './finance-articles';
import type { IPnl } from './pnl';

/**
 * Группы услуг площадки — одни на «Обзор» (TASK-125) и «Сравнение площадок»
 * (TASK-137): два экрана, сгруппировавшие услуги по-разному, показали бы разную
 * «логистику» за один период. Переехали из `crm/overview` — логика не живёт в crm.
 *
 * `Record` по всем статьям: новая статья не скомпилируется без решения, а статьи
 * вне расходов площадки — `null`. Σ групп = `marketplaceKopecks` пинит тест.
 */
export type TOverviewServiceGroup =
  | 'commission'
  | 'logistics'
  | 'promotion'
  | 'withholdings'
  | 'otherServices';

export const SERVICE_GROUPS: readonly TOverviewServiceGroup[] = [
  'commission',
  'logistics',
  'promotion',
  'withholdings',
  'otherServices',
];

export const OVERVIEW_SERVICE_GROUP: Record<TFinanceArticle, TOverviewServiceGroup | null> = {
  sales: null,
  returns: null,
  subsidies: null,
  compensations: null,
  other_income: null,
  commission: 'commission',
  delivery_to_buyer: 'logistics',
  reverse_logistics: 'logistics',
  storage: 'logistics',
  acceptance: 'logistics',
  processing: 'logistics',
  promotion: 'promotion',
  // Штрафы — тоже удержания: ТЗ не делит их, а продавцу это одна потеря.
  withholdings: 'withholdings',
  penalties: 'withholdings',
  acquiring: 'otherServices',
  paid_options: 'otherServices',
  subscription: 'otherServices',
  other_services: 'otherServices',
  bonus_payment: null,
  unknown: null,
};

/** Σ статей по группам, со знаком площадки (обычно < 0). */
export function serviceGroupsOf(pnl: IPnl): Record<TOverviewServiceGroup, number> {
  const services: Record<TOverviewServiceGroup, number> = {
    commission: 0,
    logistics: 0,
    promotion: 0,
    withholdings: 0,
    otherServices: 0,
  };
  for (const [article, group] of Object.entries(OVERVIEW_SERVICE_GROUP)) {
    if (group) services[group] += pnl.byArticle[article as TFinanceArticle].kopecks;
  }
  return services;
}
