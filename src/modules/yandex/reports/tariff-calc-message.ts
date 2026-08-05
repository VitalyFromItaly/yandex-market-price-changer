import type { ITariffCalcReport } from './profit.service';

import { b, code, esc } from '../../telegram/formatting/telegram-format';

import { BRAND_KEYS, brandTitle } from './brands';
import { formatRubles } from './money';
import { moscowDateParam } from './moscow-day';
import { brandDiscountOf, discountsOf } from './profit';
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

/** Процент без лишнего «.0»: «23», но «23.5». */
function percent(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function formatTariffCalcReport(report: ITariffCalcReport, now: Date = new Date()): string {
  const title = reportDefinition(REPORT.TARIFF_CALC).title;
  const header = `🧮 ${b(title)} ${esc(periodTitle(report.period, now))}`;
  const { totals } = report;

  // Ни одного заказа — результат, а не сбой; так отвечают остальные отчёты.
  if (!report.totalOrders) {
    return `${header}\n\nЗа этот период заказов нет.`;
  }

  const lines = [header, ''];

  if (totals.orders) {
    lines.push(
      `🛒 Оформлено: ${b(totals.orders)}`,
      `💰 Продажи: ${b(formatRubles(totals.revenue))}`,
    );

    // Субсидии называются прямо — тот же довод, что в «Прибыли»: остальные
    // отчёты печатают «Товары» как платёж покупателя, и без этой строки
    // продажи выглядели бы расхождением с ними.
    if (totals.subsidies) {
      lines.push(`   в т.ч. субсидии Маркета: ${b(formatRubles(totals.subsidies))}`);
    }

    const share = totals.revenue
      ? ` (≈${percent((totals.commission / totals.revenue) * 100)}%)`
      : '';
    lines.push(`➖ Услуги Маркета: ${b(formatRubles(totals.commission))}${share}`);

    // Разбивка по убыванию: продавец ищет самую большую статью, а не полный
    // алфавитный справочник.
    for (const [type, sum] of Object.entries(report.byService).sort((a, z) => z[1] - a[1])) {
      lines.push(`   • ${esc(serviceLabel(type))}: ${formatRubles(sum)}`);
    }

    lines.push(
      `➖ Налог ${percent(totals.rates.taxPercent)}%: ${b(formatRubles(totals.tax))}`,
      ...(totals.promo ? [`➖ Продвижение: ${b(formatRubles(totals.promo))}`] : []),
      `➖ Закуп: ${b(formatRubles(totals.purchase))}`,
      // «Ожидается»: набор — ОФОРМЛЕННЫЕ заказы, часть из них не выкупят.
      `${totals.net < 0 ? '🔻' : '📈'} Ожидается чистая: ${b(formatRubles(totals.net))}`,
      'Заказы ещё едут — часть могут не выкупить.',
    );

    // Сравнение со ставкой из настроек — по ТОЙ ЖЕ выручке, что и услуги,
    // иначе сравнивались бы разные наборы заказов.
    const flat = (totals.revenue * report.commissionPercent) / 100;
    lines.push(
      '',
      `📉 По вашей ставке ${percent(report.commissionPercent)}% было бы ` +
        `${b(formatRubles(flat))} — ${
          flat < totals.commission ? 'на' : 'то есть на'
        } ${b(formatRubles(Math.abs(totals.commission - flat)))} ` +
        `${flat < totals.commission ? 'меньше' : 'больше'} услуг, ` +
        `и чистая в «💰 Прибыли» ${flat < totals.commission ? 'выше' : 'ниже'} на ту же сумму.`,
    );
  } else {
    // Заказы есть, а посчитать нечего: причина ниже, в блоке «не учтено».
    lines.push(`🛒 Оформлено: ${b(report.totalOrders)}`, 'Посчитать не удалось ни одного заказа.');
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
        `на ${b(formatRubles(totals.excludedRevenue))} — нет закупочной цены ` +
        'или категории товара в каталоге Маркета.',
    );

    for (const sku of totals.unknownSkus.slice(0, UNKNOWN_PREVIEW)) {
      lines.push(`• ${code(sku)}`);
    }
    if (totals.unknownSkus.length > UNKNOWN_PREVIEW) {
      lines.push(`…и ещё ${totals.unknownSkus.length - UNKNOWN_PREVIEW}`);
    }
  }

  lines.push('');

  if (report.pricesUpdatedAt) {
    // Закуп — не то, что стоит в прайсе: из него вычитается скидка бренда.
    // Печатается тем же способом, что в «Прибыли», иначе два экрана объясняли
    // бы одно число по-разному.
    const config = discountsOf(totals.rates);
    const overrides = BRAND_KEYS.filter(
      (key) => brandDiscountOf(config, key) !== config.defaultPercent,
    ).map((key) => `${brandTitle(key)} ${percent(brandDiscountOf(config, key))}%`);

    lines.push(
      `💵 Закуп: прайс от ${esc(moscowDateParam(report.pricesUpdatedAt))} ` +
        `минус ${percent(config.defaultPercent)}%` +
        (overrides.length ? ` (${esc(overrides.join(', '))}).` : '.'),
    );
  } else {
    lines.push('💵 Закупочных цен пока нет — пришлите прайс, и расчёт станет полным.');
  }

  lines.push('Услуги посчитаны примерно — по тарифам Маркета, без индивидуальных условий.');

  return lines.join('\n');
}
