import type { ITariffCalcReport } from './profit.service';

import { b, esc } from '../../telegram/formatting/telegram-format';

import { formatRubles } from './money';
import { serviceLabel } from './tariff-estimate';
import { periodTitle } from './report-period';
import { reportDefinition, REPORT } from './report-status-map';

/**
 * Текст экрана «🧮 Калькулятор Маркета».
 *
 * Отдельный модуль по правилу «один экран — один текст»: у экрана два входа —
 * кнопка (ReportsHandler) и рассылка (reports.processor), и две копии текста
 * разъехались бы так же, как когда-то экраны справки.
 *
 * Экран отвечает на вопрос «сколько Маркет берёт за мои заказы и из чего это
 * складывается» — то, чего плоский процент комиссии в «Прибыли» не показывает.
 * Разбивка по услугам поэтому обязательна: одна сумма без состава читается как
 * ещё один непроверяемый процент.
 */

/** Процент без лишнего «.0»: «23», но «23.5». */
function percent(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function formatTariffCalcReport(report: ITariffCalcReport, now: Date = new Date()): string {
  const title = reportDefinition(REPORT.TARIFF_CALC).title;
  const header = `🧮 ${b(title)} ${esc(periodTitle(report.period, now))}`;

  // Ни одного заказа — результат, а не сбой; так отвечают остальные отчёты.
  if (!report.ordersCount) {
    return `${header}\n\nЗа этот период заказов нет.`;
  }

  const { estimate } = report;
  const lines = [
    header,
    '',
    `🛒 Оформлено: ${b(report.ordersCount)} на ${b(formatRubles(report.revenue))}`,
  ];

  if (estimate.coveredOrders) {
    const share = estimate.coveredRevenue
      ? ` (≈${percent((estimate.servicesTotal / estimate.coveredRevenue) * 100)}%)`
      : '';
    lines.push(`🧾 Услуги Маркета: ${b(formatRubles(estimate.servicesTotal))}${share}`);

    // Разбивка — по убыванию: продавец ищет самую большую статью, а не полный
    // алфавитный справочник.
    for (const [type, sum] of Object.entries(estimate.byService).sort((a, z) => z[1] - a[1])) {
      lines.push(`   • ${esc(serviceLabel(type))}: ${formatRubles(sum)}`);
    }

    // Строка сравнения: та же ставка, что в «Прибыли», и по той же базе, что
    // сумма услуг (выручка ПОКРЫТЫХ заказов) — иначе при частичном покрытии
    // сравнивались бы разные наборы.
    const flat = (estimate.coveredRevenue * report.commissionPercent) / 100;
    lines.push(
      `➖ Комиссия по вашей ставке ${percent(report.commissionPercent)}%: ` +
        `${b(formatRubles(flat))}`,
    );

    if (estimate.coveredOrders < estimate.totalOrders) {
      // Единственная причина непокрытия — товар без категории в каталоге:
      // габариты закрывает фолбэк. Продавец может починить это сам.
      lines.push(
        `⚠️ Посчитано ${estimate.coveredOrders} из ${estimate.totalOrders} заказов — ` +
          'у части товаров нет категории в каталоге Маркета.',
      );
    }
  } else {
    lines.push('🧾 Посчитать услуги не удалось: у товаров этих заказов нет категории в каталоге.');
  }

  lines.push('');
  lines.push('Расчёт примерный — по тарифам калькулятора Маркета, без индивидуальных условий.');

  return lines.join('\n');
}
