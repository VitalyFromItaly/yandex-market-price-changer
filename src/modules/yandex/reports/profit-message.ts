import type { IProfitReport } from './profit.service';

import { b, code, esc } from '../../telegram/formatting/telegram-format';

import { formatRubles } from './money';
import { moscowDateParam } from './moscow-day';
import { periodTitle } from './report-period';
import { reportDefinition, REPORT } from './report-status-map';

/**
 * Текст отчёта о прибыли.
 *
 * Отдельный модуль рядом с report-message.ts: у прибыли своя структура — четыре
 * вычитания и предупреждение о неучтённых заказах, — и ветвить общий форматтер
 * значило бы держать два несвязанных отчёта в одной функции.
 *
 * Проценты печатаются РЯДОМ с суммой («Комиссия 23%: 34 109 ₽») намеренно: без
 * них продавец не может проверить число, а ставки он задаёт сам и мог забыть,
 * что менял.
 *
 * Дата прайса — через moscowDateParam, а не getDate(): дата по часовому поясу
 * процесса на сервере в UTC вечером отстаёт на день (см. moscow-day.ts).
 */

/** Сколько артикулов без закупа перечислять поимённо. */
const UNKNOWN_PREVIEW = 5;

/** Процент без лишнего «.0»: «23», но «23.5». */
function percent(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function formatProfitReport(report: IProfitReport, now: Date = new Date()): string {
  const { totals } = report;
  const title = reportDefinition(REPORT.PROFIT).title;
  const header = `💰 ${b(title)} ${esc(periodTitle(report.period, now))}`;

  // Ни одного заказа — это результат, а не сбой; так же отвечают остальные отчёты.
  // Возвраты считаются заказами: «выкупленных заказов нет» при трёх возвращённых
  // было бы неправдой, и разница с отчётом «Выкуплено» осталась бы необъяснённой.
  if (!totals.orders && !totals.excludedOrders && !totals.returnedOrders) {
    return `${header}\n\nЗа этот период выкупленных заказов нет.`;
  }

  const lines = [header, ''];

  if (totals.orders) {
    lines.push(
      `📦 Заказов: ${b(totals.orders)}`,
      `💰 Продажи: ${b(formatRubles(totals.revenue))}`,
      `➖ Комиссия ${percent(totals.rates.commissionPercent)}%: ` +
        `${b(formatRubles(totals.commission))}`,
      `➖ Налог ${percent(totals.rates.taxPercent)}%: ${b(formatRubles(totals.tax))}`,
      `➖ Закуп: ${b(formatRubles(totals.purchase))}`,
      `${totals.net < 0 ? '🔻' : '✅'} Чистая: ${b(formatRubles(totals.net))}`,
    );
  }

  if (totals.returnedOrders) {
    if (totals.orders) lines.push('');

    // Возврат исключает заказ ЦЕЛИКОМ: товар вернулся на склад, деньги — покупателю.
    // Строка обязательна, иначе разница с отчётом «Выкуплено» выглядит ошибкой:
    // там заказ посчитан, здесь его нет.
    lines.push(
      `↩️ Возвраты: ${b(totals.returnedOrders)} ` +
        `на ${b(formatRubles(totals.returnedRevenue))} — исключены из расчёта целиком.`,
    );
  }

  if (totals.excludedOrders) {
    if (totals.orders || totals.returnedOrders) lines.push('');

    // Молчать здесь нельзя: без этой строки прибыль по части заказов просто
    // исчезла бы из отчёта, а выглядело бы это как «продали мало».
    lines.push(
      `⚠️ Не учтено заказов: ${b(totals.excludedOrders)} ` +
        `на ${b(formatRubles(totals.excludedRevenue))} — нет закупочной цены.`,
    );

    for (const sku of totals.unknownSkus.slice(0, UNKNOWN_PREVIEW)) {
      lines.push(`• ${code(sku)}`);
    }
    if (totals.unknownSkus.length > UNKNOWN_PREVIEW) {
      lines.push(`…и ещё ${totals.unknownSkus.length - UNKNOWN_PREVIEW}`);
    }

    lines.push('Пришлите прайс с этими позициями — они попадут в расчёт.');
  }

  lines.push('');

  if (report.pricesUpdatedAt) {
    // Скидки печатаются рядом с датой прайса: закуп — не то, что стоит в файле, и
    // продавец должен видеть, из чего он получен, иначе сумма выглядит взятой
    // с потолка.
    lines.push(
      `💵 Закуп: прайс от ${esc(moscowDateParam(report.pricesUpdatedAt))} ` +
        `минус ${percent(totals.rates.discountPercent)}% ` +
        `(Восток ${percent(totals.rates.vostokDiscountPercent)}%).`,
    );
  } else {
    lines.push('💵 Закупочных цен пока нет — пришлите прайс, и прибыль посчитается.');
  }

  return lines.join('\n');
}
