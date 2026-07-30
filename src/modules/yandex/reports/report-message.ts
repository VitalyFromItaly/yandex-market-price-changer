import { b, esc } from '../../telegram/formatting/telegram-format';
import { formatRubles } from './money';
import { DEFAULT_PERIOD, periodTitle } from './report-period';
import { REPORT } from './report-status-map';
import type { IReportResult } from './order-reports.service';

/**
 * Текст отчёта для Telegram.
 *
 * Всё через единый хелпер форматирования: parse_mode задаётся в одном месте, а
 * подстановки экранируются. Названия товаров приходят от Маркета и содержат
 * что угодно, включая `<` и `&`, — неэкранированное название роняет разметку
 * ВСЕГО сообщения, и Telegram отвечает 400, то есть отчёт не доходит вовсе.
 */

/**
 * Заголовок с периодом.
 *
 * «Едет до клиента» — срез «что сейчас в пути», а не события за период
 * (`dateFilter: 'none'`), поэтому периода в его заголовке нет: подпись
 * «за сегодня» на срезе означала бы фильтр, которого не было.
 */
function header(result: IReportResult, now: Date): string {
  const icon = ICONS[result.key] ?? '📊';
  if (result.key === REPORT.IN_TRANSIT) return `${icon} ${b(result.title)}`;

  const period = result.period ?? DEFAULT_PERIOD;
  return `${icon} ${b(result.title)} ${esc(periodTitle(period, now))}`;
}

/** Пустой отчёт — это результат, а не сбой. Так и пишем. */
function emptyMessage(result: IReportResult, now: Date): string {
  switch (result.key) {
    case REPORT.IN_TRANSIT:
      return `📦 ${b(result.title)}\n\nСейчас в пути нет ни одного заказа.`;
    case REPORT.RETURNING:
      return `↩️ ${b(result.title)}\n\nВозвратов и невыкупов нет.`;
    default:
      // «За сегодня данных нет» врало бы, когда спрошен другой период.
      return `${header(result, now)}\n\nЗа этот период данных нет.`;
  }
}

export function formatReport(result: IReportResult, now: Date = new Date()): string {
  if (!result.count) return emptyMessage(result, now);

  return [
    header(result, now),
    '',
    `📦 Заказов: ${b(result.count)}`,
    `💰 Товары: ${b(formatRubles(result.totals.items))}`,
    `🚚 С доставкой: ${b(formatRubles(result.totals.withDelivery))}`,
  ].join('\n');
}

const ICONS: Record<string, string> = {
  [REPORT.SHIPPED_TODAY]: '🚚',
  [REPORT.REDEEMED]: '✅',
  [REPORT.RETURNING]: '↩️',
  [REPORT.IN_TRANSIT]: '📦',
};
