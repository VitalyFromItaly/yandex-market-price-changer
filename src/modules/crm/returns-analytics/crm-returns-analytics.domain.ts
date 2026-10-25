import type { TFinanceMarketplace } from '../../../database/postgres/finance.schema';
import type { IFinancePeriod } from '../../finance/finance-period';
import type { IReturnsAnalytics } from '../../finance/returns-analytics';

import { MARKETPLACE_LABEL } from '../../../shared/marketplace';

/**
 * «Аналитика возвратов» CRM (TASK-145, ТЗ п.11) — доставка, уровня аккаунта.
 *
 * Числа считает `returnsAnalyticsOf` (finance) над журналом площадки экрана;
 * здесь — только перечисление полей ответа. Площадки не складываются: у каждой
 * свой экран (/ym, /ozon, /wb — `crm_marketplace_screens_own_only`).
 */

export const RETURNS_ANALYTICS_KIND = 'returns-analytics:summary';

export const RETURNS_ANALYTICS_RANGE_INVALID_TEXT =
  'Период не распознан: нужны даты начала и конца не длиннее года';

/** Сводные услуги ЯМ (хранение и обработка возвратов) в заказ и товар не делятся. */
export const RETURNS_ANALYTICS_YM_NOTE =
  'Яндекс Маркет: хранение и обработка возвратов приходят сводной строкой акта без заказа — ' +
  'в потери возвратов они не входят, их видно в «Финансах».';

export const RETURNS_ANALYTICS_OZON_NOTE =
  'Ozon: операция на несколько товаров не относится к товару — она в строке «Не отнесено к товару».';

export interface ICrmReturnsMarketplace extends IReturnsAnalytics {
  label: string;
}

export interface ICrmReturnsProblem {
  marketplace: TFinanceMarketplace;
  problem: string;
}

export interface ICrmReturnsAnalytics {
  /** Площадка экрана (эхо `params.marketplace`) — стор сверяет по ней свой ответ. */
  marketplace: TFinanceMarketplace;
  period: IFinancePeriod;
  /** Блок площадки экрана; пусто, если её журнал не прочитан (причина — в problems). */
  marketplaces: ICrmReturnsMarketplace[];
  problems: ICrmReturnsProblem[];
  notes: string[];
}

export function toCrmReturnsAnalytics(input: {
  period: IFinancePeriod;
  marketplace: TFinanceMarketplace;
  reports: readonly IReturnsAnalytics[];
  problems: readonly ICrmReturnsProblem[];
}): ICrmReturnsAnalytics {
  const notes: string[] = [];
  const opened = new Set([
    ...input.reports.map((row) => row.marketplace),
    ...input.problems.map((row) => row.marketplace),
  ]);
  if (opened.has('ym')) notes.push(RETURNS_ANALYTICS_YM_NOTE);
  if (opened.has('ozon')) notes.push(RETURNS_ANALYTICS_OZON_NOTE);
  return {
    marketplace: input.marketplace,
    period: { from: input.period.from, to: input.period.to },
    marketplaces: input.reports.map((report) => ({
      ...report,
      label: MARKETPLACE_LABEL[report.marketplace],
    })),
    problems: input.problems.map((row) => ({ ...row })),
    notes,
  };
}
