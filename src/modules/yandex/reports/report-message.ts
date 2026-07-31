import { b, esc } from '../../telegram/formatting/telegram-format';
import { formatRubles } from './money';
import { moscowStamp } from './moscow-day';
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
 * «за сегодня» на срезе означала бы фильтр, которого не было. Вместо периода
 * печатается МОМЕНТ съёмки: срез без времени нечем проверить, а расхождение с
 * кабинетом («почему у бота другое число заказов») объясняется именно им. Он же
 * попадает в журнал действий вместе с исходящим сообщением.
 */
function header(result: IReportResult, now: Date): string {
  const icon = ICONS[result.key] ?? '📊';
  if (result.key === REPORT.IN_TRANSIT) {
    return `${icon} ${b(result.title)} ${esc(`на ${moscowStamp(now)} МСК`)}`;
  }

  const period = result.period ?? DEFAULT_PERIOD;
  return `${icon} ${b(result.title)} ${esc(periodTitle(period, now))}`;
}

/** Пустой отчёт — это результат, а не сбой. Так и пишем. */
function emptyMessage(result: IReportResult, now: Date): string {
  switch (result.key) {
    case REPORT.IN_TRANSIT:
      // Через тот же header(): момент съёмки нужен и когда заказов нет —
      // «ничего не едет» без времени невозможно ни перепроверить, ни оспорить.
      return `${header(result, now)}\n\nСейчас в пути нет ни одного заказа.`;
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
