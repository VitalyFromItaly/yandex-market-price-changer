import { b, esc } from '../../telegram/formatting/telegram-format';
import { SUBSIDIES_LABEL, formatRubles } from './money';
import { moscowStamp } from './moscow-day';
import { DEFAULT_PERIOD, isUnbounded, periodTitle } from './report-period';
import { REPORT } from './report-status-map';
import { HISTORY_WINDOW_DAYS } from '../yandex-api.paths';
import { YandexApiError } from '../yandex-api.errors';
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
  return `${header(result, now)}\n\n${emptyReportText(result.key)}`;
}

/**
 * Текст пустого отчёта без заголовка и разметки — общий для бота и CRM
 * (прецедент `reportErrorMessage`): две копии формулировки разъедутся.
 *
 * Заголовок бот печатает через header() во ВСЕХ ветках: момент съёмки или
 * период нужны и тогда, когда данных нет, — «возвратов нет» без периода было
 * нечем проверить (дефект «не видно возвратов за текущий месяц»).
 */
export function emptyReportText(key: string): string {
  switch (key) {
    case REPORT.IN_TRANSIT:
      return 'Сейчас в пути нет ни одного заказа.';
    case REPORT.RETURNING:
      return 'Возвратов и невыкупов нет.';
    default:
      // «За сегодня данных нет» врало бы, когда спрошен другой период.
      return 'За этот период данных нет.';
  }
}

/** Пояснение к строке FBY-сборки — общее для бота и CRM. */
export const ASSEMBLING_NOTE =
  'Это FBY: Маркет комплектует заказ у себя и сам передаёт его в доставку.';

/**
 * Оговорка к «Всего», без значка и разметки — общая для бота и CRM. `null` —
 * период ограничен, оговорка не нужна. Почему она обязательна — см. formatReport.
 */
export function unboundedNote(result: Pick<IReportResult, 'period' | 'viaArchive'>): string | null {
  if (!isUnbounded(result.period)) return null;
  return result.viaArchive
    ? 'Срез «сейчас в пути» собран по архиву Маркета — включая заказы старше 30 дней.'
    : `Заказы Яндекс.Маркет отдаёт не старше ${HISTORY_WINDOW_DAYS} дней.`;
}

/**
 * Про обрезку книги потолком строк. Молча урезанная выгрузка выглядит как
 * полная, и расхождение с кабинетом продавец найдёт сам, в худший момент.
 * «Строк», а не «заказов», у «Едет обратно»: там строка — позиция.
 */
export function truncatedNote(key: string, rows: number, count: number): string {
  return key === REPORT.RETURNING
    ? `В файл попали первые ${rows} строк: остальные не поместились.`
    : `В файл попали первые ${rows} заказов из ${count}: остальные не поместились.`;
}

export function formatReport(result: IReportResult, now: Date = new Date()): string {
  if (!result.count) return emptyMessage(result, now);

  const lines = [
    header(result, now),
    '',
    `📦 Заказов: ${b(result.count)}`,
    `💰 Продажи: ${b(formatRubles(result.totals.sales))}`,
  ];

  /**
   * Субсидии называются прямо — тот же ярлык и то же место, что в «Прибыли».
   *
   * Продажа продавца больше платежа покупателя: скидку по акции даёт Маркет, а
   * продавцу компенсирует. Раньше здесь печатались «Товары» — платёж
   * покупателя, то есть чужое число: продавцу оно, по его же словам, не нужно
   * вовсе. Но без разбивки новую сумму не свести ни с кабинетом Маркета (там
   * платёж покупателя), ни с прежней строкой, поэтому доля Маркета печатается
   * рядом. Ноль не печатаем: «субсидии 0 ₽» ничего не сообщает.
   */
  if (result.totals.subsidies) {
    lines.push(`   ${SUBSIDIES_LABEL}: ${b(formatRubles(result.totals.subsidies))}`);
  }

  lines.push(`🚚 С доставкой: ${b(formatRubles(result.totals.withDelivery))}`);

  /**
   * Сборка на складе Маркета. Появляется только на FBY, где такие заказы в
   * срез входят: продавец там сборкой не занят вовсе, её ведёт Маркет. Без
   * строки число молча разъехалось бы и с привычным, и с кабинетом, а срез,
   * который нечем разложить, невозможно ни проверить, ни оспорить — тот же
   * довод, по которому в заголовке печатается момент съёмки.
   */
  if (result.assembling) {
    lines.push(
      '',
      `🏭 Из них собирается на складе Маркета: ${b(result.assembling)}`,
      ASSEMBLING_NOTE,
    );
  }

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
   *
   * Архивный путь (deep_history) ограничения не имеет — но и тут молчать
   * нельзя: продавец привык к старой оговорке, и её исчезновение без замены
   * читалось бы как забытая строка, а не как снятое ограничение.
   */
  const note = unboundedNote(result);
  if (note) lines.push('', `ℹ️ ${note}`);

  return lines.join('\n');
}

const ICONS: Record<string, string> = {
  [REPORT.SHIPPED_TODAY]: '🚚',
  [REPORT.REDEEMED]: '✅',
  [REPORT.RETURNING]: '↩️',
  [REPORT.IN_TRANSIT]: '📦',
};

/**
 * Текст об ошибке сборки отчёта — для пользователя.
 *
 * Один на оба пути: хендлер (replyWithError) и фоновые процессоры отчётов —
 * паттерн uploadErrorText из stock-report.ts.
 */
export function reportErrorText(error: unknown): string {
  return `❌ ${reportErrorMessage(error)}`;
}

/**
 * Та же причина без значка — для CRM, где текст ложится в интерфейс, а не в
 * чат. Одна функция на оба канала, иначе формулировки разъедутся.
 */
export function reportErrorMessage(error: unknown): string {
  return error instanceof YandexApiError
    ? error.userMessage
    : 'Не удалось собрать отчёт. Попробуйте позже.';
}
