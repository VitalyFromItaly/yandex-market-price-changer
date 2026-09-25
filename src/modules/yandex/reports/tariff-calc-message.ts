import type { ITariffCalcReport } from './profit.service';

import { b, code, esc } from '../../telegram/formatting/telegram-format';

import { SUBSIDIES_LABEL, formatRubles } from './money';
import {
  PLACED_IN_TRANSIT_NOTE,
  PROFIT_EMPTY_TEXT,
  percent,
  purchaseBasisText,
} from './profit-message';
import { periodTitle } from './report-period';
import { reportDefinition, REPORT } from './report-status-map';
import { serviceLabel } from './tariff-estimate';

/**
 * Текст экрана «🧮 Калькулятор Маркета».
 *
 * Отдельный модуль по правилу «один экран — один текст»: у экрана два входа —
 * кнопка (через очередь) и рассылка, и две копии текста разъехались бы так же,
 * как когда-то экраны справки.
 *
 * Экран отвечает на вопрос «сколько на самом деле остаётся»: та же цепочка
 * вычитаний, что в «Прибыли», но комиссия заменена суммой услуг Маркета по
 * тарифам. Разбивка по услугам обязательна — одна сумма без состава читается
 * как ещё один непроверяемый процент, ради которого экран и делали.
 *
 * ДВЕ ЧИСТЫЕ НА ДВУХ ЭКРАНАХ — это осознанно, и текст обязан назвать разницу:
 * «Прибыль» считает комиссию плоской ставкой продавца, здесь — по тарифам. На
 * боевом магазине это 29 % против 16 %, то есть расхождение в сотни тысяч, и
 * без строки сравнения продавец решит, что один из экранов врёт.
 */

/** Сколько артикулов без закупа перечислять поимённо. */
const UNKNOWN_PREVIEW = 5;

/*
 * Тексты и решения, нужные боту и CRM, — без разметки (довод profit-message).
 */

export const TARIFF_APPROX_NOTE =
  'Услуги посчитаны примерно — по тарифам Маркета, без индивидуальных условий.';
export const TARIFF_NO_PRICES_TEXT =
  'Закупочных цен пока нет — пришлите прайс, и расчёт станет полным.';
export const TARIFF_NOTHING_COUNTED = 'Посчитать не удалось ни одного заказа.';
export const TARIFF_EXCLUDED_REASON = 'нет закупочной цены или категории товара в каталоге Маркета';

/** «≈24%» — доля услуг от выручки посчитанных заказов; null — выручки нет. */
export function servicesShare(report: ITariffCalcReport): string | null {
  const { totals } = report;
  return totals.revenue ? `≈${percent((totals.commission / totals.revenue) * 100)}%` : null;
}

export interface ITariffService {
  type: string;
  label: string;
  sum: number;
}

/**
 * Разбивка по услугам — по убыванию: продавец ищет самую большую статью, а не
 * алфавитный справочник. Сумма равна «Услугам Маркета» по построению сервиса.
 */
export function servicesBreakdown(byService: Record<string, number>): ITariffService[] {
  return Object.entries(byService)
    .sort((a, z) => z[1] - a[1])
    .map(([type, sum]) => ({ type, label: serviceLabel(type), sum }));
}

export interface IFlatComparison {
  /** Сколько было бы по плоской ставке продавца — по ТОЙ ЖЕ выручке. */
  flat: number;
  /** |услуги − flat|. */
  diff: number;
  /** Услуги по тарифам дороже ставки из настроек. */
  servicesHigher: boolean;
}

/**
 * Сравнение со ставкой из настроек — по той же выручке, что и услуги, иначе
 * сравнивались бы разные наборы заказов. Без него продавец решит, что один из
 * двух экранов с чистой врёт.
 */
export function flatComparison(report: ITariffCalcReport): IFlatComparison {
  const { totals } = report;
  const flat = (totals.revenue * report.commissionPercent) / 100;
  return {
    flat,
    diff: Math.abs(totals.commission - flat),
    servicesHigher: flat < totals.commission,
  };
}

/** Строка сравнения без разметки — готовая фраза для CRM. */
export function flatComparisonText(report: ITariffCalcReport, bold = (v: string) => v): string {
  const { flat, diff, servicesHigher } = flatComparison(report);
  return (
    `По вашей ставке ${percent(report.commissionPercent)}% было бы ` +
    `${bold(formatRubles(flat))} — ${servicesHigher ? 'на' : 'то есть на'} ` +
    `${bold(formatRubles(diff))} ` +
    `${servicesHigher ? 'меньше' : 'больше'} услуг, ` +
    `и чистая в «💰 Прибыли» ${servicesHigher ? 'выше' : 'ниже'} на ту же сумму.`
  );
}

export function formatTariffCalcReport(report: ITariffCalcReport, now: Date = new Date()): string {
  const title = reportDefinition(REPORT.TARIFF_CALC).title;
  const header = `🧮 ${b(title)} ${esc(periodTitle(report.period, now))}`;
  const { totals } = report;

  // Ни одного заказа — результат, а не сбой; так отвечают остальные отчёты.
  if (!report.totalOrders) {
    return `${header}\n\n${PROFIT_EMPTY_TEXT}`;
  }

  const lines = [header, ''];

  if (totals.orders) {
    lines.push(
      `🛒 Оформлено: ${b(totals.orders)}`,
      `💰 Продажи: ${b(formatRubles(totals.revenue))}`,
    );

    // Субсидии называются прямо — тот же довод, что в «Прибыли».
    if (totals.subsidies) {
      lines.push(`   ${SUBSIDIES_LABEL}: ${b(formatRubles(totals.subsidies))}`);
    }

    const share = servicesShare(report);
    lines.push(
      `➖ Услуги Маркета: ${b(formatRubles(totals.commission))}${share ? ` (${share})` : ''}`,
    );

    for (const service of servicesBreakdown(report.byService)) {
      lines.push(`   • ${esc(service.label)}: ${formatRubles(service.sum)}`);
    }

    lines.push(
      `➖ Налог ${percent(totals.rates.taxPercent)}%: ${b(formatRubles(totals.tax))}`,
      ...(totals.promo ? [`➖ Продвижение: ${b(formatRubles(totals.promo))}`] : []),
      `➖ Закуп: ${b(formatRubles(totals.purchase))}`,
      // «Ожидается»: набор — ОФОРМЛЕННЫЕ заказы, часть из них не выкупят.
      `${totals.net < 0 ? '🔻' : '📈'} Ожидается чистая: ${b(formatRubles(totals.net))}`,
      PLACED_IN_TRANSIT_NOTE,
    );

    lines.push('', `📉 ${flatComparisonText(report, b)}`);
  } else {
    // Заказы есть, а посчитать нечего: причина ниже, в блоке «не учтено».
    lines.push(`🛒 Оформлено: ${b(report.totalOrders)}`, TARIFF_NOTHING_COUNTED);
  }

  if (totals.returnedOrders) {
    lines.push(
      `↩️ Возвраты: ${b(totals.returnedOrders)} ` +
        `на ${b(formatRubles(totals.returnedRevenue))} — исключены из расчёта целиком.`,
    );
  }

  // Причин выпасть из расчёта ДВЕ, и обе называются: нет закупочной цены (это
  // продавец чинит прайсом) или нет категории товара в каталоге Маркета (это
  // чинится в кабинете). Молчать нельзя — иначе часть заказов просто исчезает.
  if (totals.excludedOrders) {
    lines.push(
      '',
      `⚠️ Не учтено заказов: ${b(totals.excludedOrders)} ` +
        `на ${b(formatRubles(totals.excludedRevenue))} — ${TARIFF_EXCLUDED_REASON}.`,
    );

    for (const sku of totals.unknownSkus.slice(0, UNKNOWN_PREVIEW)) {
      lines.push(`• ${code(sku)}`);
    }
    if (totals.unknownSkus.length > UNKNOWN_PREVIEW) {
      lines.push(`…и ещё ${totals.unknownSkus.length - UNKNOWN_PREVIEW}`);
    }
  }

  lines.push('');

  // Закуп — не то, что стоит в прайсе: из него вычитается скидка бренда.
  // Печатается той же функцией, что в «Прибыли», иначе два экрана объясняли
  // бы одно число по-разному.
  lines.push(
    report.pricesUpdatedAt
      ? `💵 Закуп: ${esc(purchaseBasisText(report.pricesUpdatedAt, totals.rates))}`
      : `💵 ${TARIFF_NO_PRICES_TEXT}`,
  );

  lines.push(TARIFF_APPROX_NOTE);

  return lines.join('\n');
}
