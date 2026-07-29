import { b, esc } from '../../telegram/formatting/telegram-format';
import { formatRubles } from './money';
import { moscowDateParam } from './moscow-day';
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

/** Пустой отчёт — это результат, а не сбой. Так и пишем. */
function emptyMessage(result: IReportResult, now: Date): string {
  const date = moscowDateParam(now);

  switch (result.key) {
    case REPORT.IN_TRANSIT:
      return `📦 ${b(result.title)}\n\nСейчас в пути нет ни одного заказа.`;
    case REPORT.RETURNING:
      return `↩️ ${b(result.title)}\n\nВозвратов и невыкупов нет.`;
    default:
      return `📊 ${b(result.title)} за ${esc(date)}\n\nЗа сегодня данных нет.`;
  }
}

export function formatReport(result: IReportResult, now: Date = new Date()): string {
  if (!result.count) return emptyMessage(result, now);

  const icon = ICONS[result.key] ?? '📊';
  const header =
    result.key === REPORT.IN_TRANSIT
      ? `${icon} ${b(result.title)}`
      : `${icon} ${b(result.title)} за ${esc(moscowDateParam(now))}`;

  return [
    header,
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
