import type {
  CancelledResponse,
  KpiKey,
  KpiView,
  OverviewTotals,
  StocksResponse,
  SummaryResponse,
} from '../overview.domain';

import { unconfirmedSummary } from '../../../../../../src/shared/profit-confirmation';

import { deltaCaption, formatCount, formatKopecks, plural } from '@/shared/utils';

/**
 * Карточки «Обзора» из ответов задач. Ничего не пересчитывается: числа — из
 * тех же полей, что строки «Прибыли» (`levels`), здесь только вид и динамика.
 * Расходы журнал несёт со знаком площадки («−» удержание); карточка расхода
 * показывает сумму без минуса — подпись уже говорит, что это расход.
 */

const PERCENT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

// Фраза динамики общая с «Аналитикой продаж» — переехала в shared/utils.
export { deltaCaption };

const money = (kopecks: number): string => formatKopecks(kopecks);
/** Расход со знаком площадки → сумма без минуса. */
const cost = (kopecks: number): number => -kopecks;
const signTone = (kopecks: number): KpiView['tone'] => {
  if (kopecks > 0) return 'ok';
  return kopecks < 0 ? 'danger' : 'neutral';
};

function percentOf(ratio: number | null): string {
  return ratio === null ? '—' : `${PERCENT.format(ratio * 100)} %`;
}

/** Числа карточки из итогов периода: одно место, чтобы текущий и прошлый считались одинаково. */
function numbersOf(
  t: OverviewTotals,
): Record<Exclude<KpiKey, 'cancelled' | 'receivable' | 'stockValue' | 'inTransit'>, number | null> {
  return {
    revenue: t.levels.revenueKopecks,
    orders: t.ordersCount,
    units: t.units,
    avgCheck: t.avgCheckKopecks,
    cogs: t.levels.cogsKopecks,
    commission: cost(t.services.commission),
    logistics: cost(t.services.logistics),
    promotion: cost(t.services.promotion),
    tax: t.levels.taxKopecks,
    withholdings: cost(t.services.withholdings),
    returns: cost(t.returnsKopecks),
    gross: t.levels.grossKopecks,
    operating: t.levels.operatingKopecks,
    net: t.levels.netKopecks,
    margin: t.levels.netMargin,
  };
}

/** Карточки из `overview:summary`: деньги журнала, динамика, «к получению». */
export function mapSummaryKpis(data: SummaryResponse): Partial<Record<KpiKey, KpiView>> {
  const now = numbersOf(data.current);
  const before = numbersOf(data.previous);
  const delta = (key: keyof typeof now): string | null => {
    const a = now[key];
    const b = before[key];
    return a === null || b === null ? null : deltaCaption(a, b);
  };
  const view = (key: keyof typeof now, value: string, tone: KpiView['tone'] = 'neutral') => ({
    value,
    caption: delta(key),
    tone,
  });
  const orders = data.current.ordersCount;
  const receivable = data.receivable;

  return {
    revenue: view('revenue', money(data.current.levels.revenueKopecks)),
    orders: view('orders', formatCount(orders)),
    units: view('units', `${formatCount(data.current.units)} шт.`),
    avgCheck: {
      value: data.current.avgCheckKopecks === null ? '—' : money(data.current.avgCheckKopecks),
      caption: data.current.avgCheckKopecks === null ? 'заказов нет' : delta('avgCheck'),
      tone: 'neutral',
    },
    cogs: {
      ...view('cogs', money(data.current.levels.cogsKopecks)),
      // Позиции без закупа: себестоимость занижена, чистая завышена — сказать прямо.
      caption: unconfirmedSummary(data.unconfirmed, formatKopecks) ?? delta('cogs'),
    },
    commission: view('commission', money(cost(data.current.services.commission))),
    logistics: view('logistics', money(cost(data.current.services.logistics))),
    promotion: view('promotion', money(cost(data.current.services.promotion))),
    tax: {
      ...view('tax', money(data.current.levels.taxKopecks)),
      caption: data.taxIsDefault ? 'по умолчанию: УСН «Доходы» 6 %' : delta('tax'),
    },
    withholdings: view('withholdings', money(cost(data.current.services.withholdings))),
    returns: view('returns', money(cost(data.current.returnsKopecks))),
    gross: view(
      'gross',
      money(data.current.levels.grossKopecks),
      signTone(data.current.levels.grossKopecks),
    ),
    operating: view(
      'operating',
      money(data.current.levels.operatingKopecks),
      signTone(data.current.levels.operatingKopecks),
    ),
    net: view(
      'net',
      money(data.current.levels.netKopecks),
      signTone(data.current.levels.netKopecks),
    ),
    margin: {
      value: percentOf(data.current.levels.netMargin),
      caption:
        data.current.levels.grossMargin === null
          ? null
          : `валовая — ${percentOf(data.current.levels.grossMargin)}`,
      tone: signTone(data.current.levels.netKopecks),
    },
    receivable: {
      value: money(receivable.totalKopecks),
      caption: `${formatCount(receivable.operationCount)} ${plural(receivable.operationCount, [
        'операция',
        'операции',
        'операций',
      ])} без выплаты, на сегодня`,
      tone: 'neutral',
    },
  };
}

/** Карточки срезов Маркета по магазинам кабинета. */
export function mapStocksKpis(data: StocksResponse): Partial<Record<KpiKey, KpiView>> {
  const missing = data.withoutCost.skus;
  const stockCaption = missing
    ? `${formatCount(data.stockUnits)} шт.; без закупа ${formatCount(missing)} ${plural(missing, [
        'позиция',
        'позиции',
        'позиций',
      ])} — не учтены`
    : `${formatCount(data.stockUnits)} шт. по текущему закупу`;
  const inTransit = data.inTransit;
  return {
    stockValue: { value: money(data.stockValueKopecks), caption: stockCaption, tone: 'neutral' },
    inTransit: inTransit
      ? {
          value: `${formatCount(inTransit.units)} шт.`,
          caption: `${formatCount(inTransit.orders)} ${plural(inTransit.orders, [
            'заказ',
            'заказа',
            'заказов',
          ])} на ${money(inTransit.salesKopecks)}`,
          tone: 'neutral',
        }
      : { value: '—', caption: 'отчёт «Едет до клиента» закрыт', tone: 'neutral' },
  };
}

export function mapCancelledKpi(data: CancelledResponse): Partial<Record<KpiKey, KpiView>> {
  return {
    cancelled:
      data.count === null
        ? { value: '—', caption: data.note, tone: 'neutral' }
        : {
            value: formatCount(data.count),
            caption: plural(data.count, ['заказ отменён', 'заказа отменено', 'заказов отменено']),
            tone: 'neutral',
          },
  };
}
