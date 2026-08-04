import { b, esc } from '../../telegram/formatting/telegram-format';
import { formatRubles } from './money';
import { moscowStamp } from './moscow-day';
import { DEFAULT_PERIOD, isUnbounded, periodTitle } from './report-period';
import { REPORT } from './report-status-map';
import { HISTORY_WINDOW_DAYS } from '../yandex-api.paths';
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
      // Через header(), как и остальные: раньше эта ветка печатала заголовок
      // сама и БЕЗ периода, из-за чего «возвратов нет» было нечем проверить —
      // непонятно даже, за что именно их не нашли. Ровно так и выглядел дефект
      // «не видно возвратов за текущий месяц».
      return `${header(result, now)}\n\nВозвратов и невыкупов нет.`;
    default:
      // «За сегодня данных нет» врало бы, когда спрошен другой период.
      return `${header(result, now)}\n\nЗа этот период данных нет.`;
  }
}

export function formatReport(result: IReportResult, now: Date = new Date()): string {
  if (!result.count) return emptyMessage(result, now);

  const lines = [
    header(result, now),
    '',
    `📦 Заказов: ${b(result.count)}`,
    `💰 Товары: ${b(formatRubles(result.totals.items))}`,
    `🚚 С доставкой: ${b(formatRubles(result.totals.withDelivery))}`,
  ];

  /**
   * Разбивка возвратов. Одно число «возвратов 41» не отвечает на вопрос, ради
   * которого кнопку и жмут: сколько ещё ЕДЕТ. Сумма `inFlight` — то самое
   * число, что продавец видит в кабинете, и сверяться он будет именно с ним.
   */
  if (result.returns?.count) {
    // На «Всего» спрашиваются только АКТИВНЫЕ возвраты, поэтому разбивка там
    // выродилась бы в «выдано магазину 0» — строку, которая ничего не сообщает.
    lines.push(
      '',
      isUnbounded(result.period)
        ? `↩️ Активных возвратов: ${b(result.returns.count)} — едут к вам`
        : `↩️ Возвраты: ${b(result.returns.count)}` +
            ` — едет ${b(result.returns.inFlight)}, выдано магазину ${b(result.returns.settled)}`,
    );
  }

  /**
   * «Всего» честно лишь наполовину, и промолчать об этом нельзя: возвраты
   * приходят все, а заказы — сколько хранит Partner API (около 30 дней).
   * Без оговорки продавец сверял бы неполный набор заказов с полным набором
   * возвратов и не понимал расхождения.
   */
  if (isUnbounded(result.period)) {
    lines.push('', `ℹ️ Заказы Яндекс.Маркет отдаёт не старше ${HISTORY_WINDOW_DAYS} дней.`);
  }

  return lines.join('\n');
}

const ICONS: Record<string, string> = {
  [REPORT.SHIPPED_TODAY]: '🚚',
  [REPORT.REDEEMED]: '✅',
  [REPORT.RETURNING]: '↩️',
  [REPORT.IN_TRANSIT]: '📦',
};
