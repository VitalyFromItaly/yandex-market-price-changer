import type { IProfitReport } from './profit.service';
import type { IProfitTotals } from './profit';

import { b, code, esc } from '../../telegram/formatting/telegram-format';

import { BRAND_KEYS, brandTitle } from './brands';
import { formatRubles } from './money';
import { brandDiscountOf, discountsOf } from './profit';
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
 * ДВА НАБОРА ЗАКАЗОВ, и это главное, что должен объяснить текст. Продавец
 * сверяется с кабинетом, где видит ОФОРМЛЕННЫЕ заказы, а прибыль считается по
 * ВЫКУПЛЕННЫМ — 30-07-2026 это дало 11 против 10, и отчёт выглядел сломанным.
 * Наборы пересекаются едва-едва: сегодняшние заказы выкупят через неделю, а
 * сегодняшние выкупы оформлены раньше. Поэтому цифры печатаются обе, и строка
 * «Это другие заказы» обязательна — без неё одно расхождение просто сменится
 * другим: «почему выкупленные не входят в оформленные?».
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

/** Есть ли в наборе хоть что-нибудь, о чём стоит сказать. */
function isEmpty(totals: IProfitTotals): boolean {
  return !totals?.orders && !totals?.excludedOrders && !totals?.returnedOrders;
}

/**
 * Полная разбивка одного набора: продажи, три вычитания и чистая.
 *
 * Общая для обоих наборов, потому что вычитания у них одни и те же. Отличаются
 * только подписи первой и последней строки: у оформленных прибыль ОЖИДАЕМАЯ,
 * и назвать её просто «чистой» значило бы выдать прогноз за полученные деньги.
 */
function detailedBlock(totals: IProfitTotals, kind: 'placed' | 'redeemed'): string[] {
  const placed = kind === 'placed';

  const lines = [
    placed ? `🛒 Оформлено: ${b(totals.orders)}` : `📦 Заказов: ${b(totals.orders)}`,
    `💰 Продажи: ${b(formatRubles(totals.revenue))}`,
  ];

  /**
   * Субсидии называются прямо. Остальные отчёты печатают «Товары» как ПЛАТЁЖ
   * ПОКУПАТЕЛЯ, а продажи здесь включают ещё и компенсацию Маркета — без этой
   * строки разница между экранами выглядела бы ошибкой. За июль это 421 тыс. ₽
   * на 2,46 млн платежей, то есть спорить о ней придётся обязательно.
   */
  if (totals.subsidies) {
    lines.push(`   в т.ч. субсидии Маркета: ${b(formatRubles(totals.subsidies))}`);
  }

  return [
    ...lines,
    `➖ Комиссия ${percent(totals.rates.commissionPercent)}%: ` +
      `${b(formatRubles(totals.commission))}`,
    `➖ Налог ${percent(totals.rates.taxPercent)}%: ${b(formatRubles(totals.tax))}`,
    `➖ Закуп: ${b(formatRubles(totals.purchase))}`,
    placed
      ? `${totals.net < 0 ? '🔻' : '📈'} Ожидается чистая: ${b(formatRubles(totals.net))}`
      : `${totals.net < 0 ? '🔻' : '✅'} Чистая: ${b(formatRubles(totals.net))}`,
  ];
}

export function formatProfitReport(report: IProfitReport, now: Date = new Date()): string {
  const { totals, placed } = report;
  const title = reportDefinition(REPORT.PROFIT).title;
  const header = `💰 ${b(title)} ${esc(periodTitle(report.period, now))}`;

  // Ни одного заказа ни в одном наборе — это результат, а не сбой; так же
  // отвечают остальные отчёты. Отменённые тоже считаются заказами: «заказов
  // нет» при трёх отменённых было бы неправдой.
  if (isEmpty(totals) && isEmpty(placed) && !report.cancelledOrders) {
    return `${header}\n\nЗа этот период заказов нет.`;
  }

  const lines = [header, ''];

  // --- оформлено за период: то, что продавец видит в кабинете ---------------
  //
  // Разбивка целиком достаётся ОСНОВНОМУ набору. Когда оформленных за период
  // нет (отчёт за прошедший день, выходной), основным становится выкупленное:
  // иначе сообщение схлопнулось бы в одну строку и продавец потерял бы
  // комиссию, налог и закуп — то, ради чего отчёт и открывают.
  const placedIsMain = !!placed?.orders;

  if (placedIsMain) {
    lines.push(...detailedBlock(placed, 'placed'), 'Заказы ещё едут — часть могут не выкупить.');
  }

  // Отменённые в кабинете лежат в общем списке. Промолчав о них, мы получим
  // цифру меньше той, что видит продавец, — то самое расхождение, из-за
  // которого отчёт и переделывали.
  if (report.cancelledOrders) {
    lines.push(`✖️ Отменено: ${b(report.cancelledOrders)} — в расчёт не входят.`);
  }

  // --- выкуплено за период: деньги, которые уже получены --------------------
  if (totals?.orders) {
    if (lines.length > 2) lines.push('');

    if (placedIsMain) {
      // Рядом с основным блоком — одной строкой, иначе два одинаковых столбца
      // вычитаний подряд читаются как ошибка отчёта. Пояснение про «другие
      // заказы» обязательно: без него 11 и 9 выглядят как целое и часть.
      lines.push(
        `✅ Выкуплено: ${b(totals.orders)} на ${b(formatRubles(totals.revenue))} → ` +
          `чистая ${b(formatRubles(totals.net))}`,
        'Это другие заказы: оформленные за период попадут сюда после выкупа.',
      );
    } else {
      lines.push(...detailedBlock(totals, 'redeemed'));
    }
  }

  if (totals?.returnedOrders) {
    // Возврат исключает заказ ЦЕЛИКОМ: товар вернулся на склад, деньги — покупателю.
    // Строка обязательна, иначе разница с отчётом «Выкуплено» выглядит ошибкой:
    // там заказ посчитан, здесь его нет.
    lines.push(
      `↩️ Возвраты: ${b(totals.returnedOrders)} ` +
        `на ${b(formatRubles(totals.returnedRevenue))} — исключены из расчёта целиком.`,
    );
  }

  // --- заказы без закупочной цены: один блок на оба набора ------------------
  //
  // Список артикулов объединён намеренно: продавцу всё равно грузить их одним
  // прайсом, а два одинаковых списка подряд читаются как ошибка отчёта.
  const excludedOrders = (placed?.excludedOrders ?? 0) + (totals?.excludedOrders ?? 0);
  const excludedRevenue = (placed?.excludedRevenue ?? 0) + (totals?.excludedRevenue ?? 0);
  const unknownSkus = [
    ...new Set([...(placed?.unknownSkus ?? []), ...(totals?.unknownSkus ?? [])]),
  ];

  if (excludedOrders) {
    lines.push('');

    // Молчать здесь нельзя: без этой строки прибыль по части заказов просто
    // исчезла бы из отчёта, а выглядело бы это как «продали мало».
    lines.push(
      `⚠️ Не учтено заказов: ${b(excludedOrders)} ` +
        `на ${b(formatRubles(excludedRevenue))} — нет закупочной цены.`,
    );

    for (const sku of unknownSkus.slice(0, UNKNOWN_PREVIEW)) {
      lines.push(`• ${code(sku)}`);
    }
    if (unknownSkus.length > UNKNOWN_PREVIEW) {
      lines.push(`…и ещё ${unknownSkus.length - UNKNOWN_PREVIEW}`);
    }

    lines.push('Пришлите прайс с этими позициями — они попадут в расчёт.');
  }

  lines.push('');

  if (report.pricesUpdatedAt) {
    // Скидки печатаются рядом с датой прайса: закуп — не то, что стоит в файле, и
    // продавец должен видеть, из чего он получен, иначе сумма выглядит взятой
    // с потолка.
    //
    // В скобках — только бренды, чья скидка ОТЛИЧАЕТСЯ от общей: перечислять
    // все шесть с одинаковым процентом значило бы утопить полезное в шуме.
    // У нетронутого продавца это ровно «(Восток 4%)» — легаси-фолбэк
    // vostokDiscountPercent запечён в конфиг (см. discountsOf).
    const rates = placed?.rates ?? totals.rates;
    const config = discountsOf(rates);
    const overrides = BRAND_KEYS.filter(
      (key) => brandDiscountOf(config, key) !== config.defaultPercent,
    ).map((key) => `${brandTitle(key)} ${percent(brandDiscountOf(config, key))}%`);

    lines.push(
      `💵 Закуп: прайс от ${esc(moscowDateParam(report.pricesUpdatedAt))} ` +
        `минус ${percent(config.defaultPercent)}%` +
        (overrides.length ? ` (${esc(overrides.join(', '))}).` : '.'),
    );
  } else {
    lines.push('💵 Закупочных цен пока нет — пришлите прайс, и прибыль посчитается.');
  }

  return lines.join('\n');
}
