import type { IProfitReport } from './profit.service';
import type { IProfitRates, IProfitTotals } from './profit';
import type { ITariffEstimate } from './tariff-estimate';

import { b, code, esc } from '../../telegram/formatting/telegram-format';

import { BRAND_KEYS, brandTitle } from './brands';
import { SUBSIDIES_LABEL, formatRubles } from './money';
import { brandDiscountOf, discountsOf } from './profit';
import { promoConfigsOf, promoValueLabel } from './promo';
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
export function percent(value: number): string {
  return String(Number(value.toFixed(2)));
}

/*
 * Тексты и решения, нужные ДВУМ каналам — боту и CRM. Без разметки: HTML
 * накладывает только formatProfitReport. Вынесены сюда, а не скопированы в
 * CRM, — прецедент emptyReportText в report-message.ts: две копии одной
 * формулировки расходятся молча.
 */

export const PROFIT_EMPTY_TEXT = 'За этот период заказов нет.';
export const PLACED_IN_TRANSIT_NOTE = 'Заказы ещё едут — часть могут не выкупить.';
export const OTHER_ORDERS_NOTE =
  'Это другие заказы: оформленные за период попадут сюда после выкупа.';
export const UNKNOWN_SKUS_ADVICE = 'Пришлите прайс с этими позициями — они попадут в расчёт.';
export const NO_PRICES_TEXT = 'Закупочных цен пока нет — пришлите прайс, и прибыль посчитается.';

/** Есть ли в наборе хоть что-нибудь, о чём стоит сказать. */
function isEmpty(totals: IProfitTotals): boolean {
  return !totals?.orders && !totals?.excludedOrders && !totals?.returnedOrders;
}

/**
 * Ни одного заказа ни в одном наборе — это результат, а не сбой. Отменённые
 * тоже считаются заказами: «заказов нет» при трёх отменённых было бы неправдой.
 */
export function isProfitEmpty(report: IProfitReport): boolean {
  return isEmpty(report.totals) && isEmpty(report.placed) && !report.cancelledOrders;
}

/**
 * Какой набор получает полную разбивку. Когда оформленных за период нет (отчёт
 * за прошедший день, выходной), основным становится выкупленное: иначе отчёт
 * схлопнулся бы в одну строку и продавец потерял бы комиссию, налог и закуп.
 * Тот же предикат считает оценку калькулятора в ProfitService.build.
 */
export function profitMainBlock(report: IProfitReport): 'placed' | 'redeemed' {
  return report.placed?.orders ? 'placed' : 'redeemed';
}

/**
 * Оценка калькулятора — только для основного блока. Совпадение scope
 * проверяется явно: если предикаты сервиса и отчёта разойдутся, строка с
 * чужим набором хуже, чем её отсутствие. Пустая оценка (ни одного покрытого
 * заказа) тоже не показывается: «0 ₽» читался бы как «услуги бесплатны».
 */
export function mainTariffEstimate(report: IProfitReport): ITariffEstimate | undefined {
  const estimate = report.tariffEstimate;
  return estimate?.scope === profitMainBlock(report) && estimate.coveredOrders
    ? estimate
    : undefined;
}

export interface IProfitExcluded {
  orders: number;
  revenue: number;
  /** Артикулы без закупа — объединение обоих наборов без повторов. */
  skus: string[];
}

/**
 * Заказы без закупочной цены — один блок на оба набора: продавцу всё равно
 * грузить их одним прайсом, а два одинаковых списка подряд читаются как ошибка.
 */
export function profitExcluded(report: IProfitReport): IProfitExcluded {
  const { placed, totals } = report;
  return {
    orders: (placed?.excludedOrders ?? 0) + (totals?.excludedOrders ?? 0),
    revenue: (placed?.excludedRevenue ?? 0) + (totals?.excludedRevenue ?? 0),
    skus: [...new Set([...(placed?.unknownSkus ?? []), ...(totals?.unknownSkus ?? [])])],
  };
}

export interface IPurchaseBasis {
  defaultPercent: number;
  /** Бренды, чья скидка ОТЛИЧАЕТСЯ от общей, в порядке реестра. */
  overrides: { title: string; percent: number }[];
}

/**
 * Из чего получен закуп: общая скидка от прайса и бренды со своей.
 *
 * Перечисляются только отличающиеся бренды: все шесть с одинаковым процентом
 * утопили бы полезное в шуме. У нетронутого продавца это ровно «Восток 4%» —
 * легаси-фолбэк vostokDiscountPercent запечён в конфиг (см. discountsOf).
 * Общее для «Прибыли» и «Калькулятора»: два экрана не должны объяснять одно
 * число по-разному.
 */
export function purchaseBasis(rates: IProfitRates): IPurchaseBasis {
  const config = discountsOf(rates);
  return {
    defaultPercent: config.defaultPercent,
    overrides: BRAND_KEYS.filter(
      (key) => brandDiscountOf(config, key) !== config.defaultPercent,
    ).map((key) => ({ title: brandTitle(key), percent: brandDiscountOf(config, key) })),
  };
}

/** «прайс от ДД-ММ-ГГГГ минус 10% (Восток 4%).» — хвост строки о закупе. */
export function purchaseBasisText(pricesUpdatedAt: Date, rates: IProfitRates): string {
  const basis = purchaseBasis(rates);
  const overrides = basis.overrides.map((item) => `${item.title} ${percent(item.percent)}%`);
  return (
    `прайс от ${moscowDateParam(pricesUpdatedAt)} минус ${percent(basis.defaultPercent)}%` +
    (overrides.length ? ` (${overrides.join(', ')}).` : '.')
  );
}

/**
 * Ставки продвижения по брендам — чтобы сумма «Продвижение» была проверяема.
 * Только настроенные бренды: для остальных продвижения нет, и «CASIO 0%»
 * значил бы не то.
 */
export function promoParts(rates: IProfitRates): string[] {
  const configs = promoConfigsOf(rates.promoCommissions);
  return BRAND_KEYS.filter((key) => configs[key]).map(
    (key) => `${brandTitle(key)} ${promoValueLabel(configs[key])}`,
  );
}

/**
 * «≈24%» или «≈24% по 3 из 5 заказов» — доля услуг калькулятора от выручки
 * ПОКРЫТЫХ заказов. При частичном покрытии счётчик обязателен: без него
 * процент выглядел бы долей от всего набора. null — выручки покрытых нет.
 */
export function tariffEstimateShare(estimate: ITariffEstimate): string | null {
  if (!estimate.coveredRevenue) return null;
  const share = `≈${percent((estimate.servicesTotal / estimate.coveredRevenue) * 100)}%`;
  return estimate.coveredOrders === estimate.totalOrders
    ? share
    : `${share} по ${estimate.coveredOrders} из ${estimate.totalOrders} заказов`;
}

/**
 * Строка «по калькулятору Маркета» — сверка комиссии с тарифами услуг.
 *
 * БЕЗ «➖»: столбец с минусами — это арифметика чистой, а эта строка
 * информационная и в вычитания не входит. «≈» проговаривает, что расчёт
 * примерный — так его называет документация самого метода. Процент — от
 * выручки ПОКРЫТЫХ заказов, поэтому при частичном покрытии в скобках счётчик:
 * без него «≈24% по трети заказов» выглядел бы как процент от всего набора.
 */
function tariffEstimateLine(estimate: ITariffEstimate): string {
  const text = tariffEstimateShare(estimate);
  const share = text ? ` (${text})` : '';
  return `🧮 По калькулятору Маркета: ${b(formatRubles(estimate.servicesTotal))}${share}`;
}

/**
 * Полная разбивка одного набора: продажи, три вычитания и чистая.
 *
 * Общая для обоих наборов, потому что вычитания у них одни и те же. Отличаются
 * только подписи первой и последней строки: у оформленных прибыль ОЖИДАЕМАЯ,
 * и назвать её просто «чистой» значило бы выдать прогноз за полученные деньги.
 */
function detailedBlock(
  totals: IProfitTotals,
  kind: 'placed' | 'redeemed',
  estimate?: ITariffEstimate,
): string[] {
  const placed = kind === 'placed';

  const lines = [
    placed ? `🛒 Оформлено: ${b(totals.orders)}` : `📦 Заказов: ${b(totals.orders)}`,
    `💰 Продажи: ${b(formatRubles(totals.revenue))}`,
  ];

  /**
   * Субсидии называются прямо: продажа продавца включает компенсацию Маркета, а
   * покупатель заплатил меньше — за июль разница 421 тыс. ₽ на 2,46 млн, то
   * есть спорить о ней придётся обязательно.
   *
   * Подпись берётся из общей константы, потому что ТУ ЖЕ строку печатают
   * четыре отчёта о заказах (report-message.ts): число и формула у них одни,
   * и две формулировки читались бы как два разных показателя. Сама строка
   * дублируется намеренно — у прибыли своя структура блока, и ветвить общий
   * форматтер значило бы держать два несвязанных отчёта в одной функции.
   */
  if (totals.subsidies) {
    lines.push(`   ${SUBSIDIES_LABEL}: ${b(formatRubles(totals.subsidies))}`);
  }

  return [
    ...lines,
    `➖ Комиссия ${percent(totals.rates.commissionPercent)}%: ` +
      `${b(formatRubles(totals.commission))}`,
    // Сразу под комиссией — то, с чем её сверяют (пустую отсекает mainTariffEstimate).
    ...(estimate ? [tariffEstimateLine(estimate)] : []),
    `➖ Налог ${percent(totals.rates.taxPercent)}%: ${b(formatRubles(totals.tax))}`,
    // Продвижение — только когда начислено: ноль в столбце вычитаний — шум, а
    // не настроившие буст продавцы не должны гадать, что это за строка.
    ...(totals.promo ? [`➖ Продвижение: ${b(formatRubles(totals.promo))}`] : []),
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

  // Пустой отчёт — результат, а не сбой; так же отвечают остальные отчёты.
  if (isProfitEmpty(report)) {
    return `${header}\n\n${PROFIT_EMPTY_TEXT}`;
  }

  const lines = [header, ''];

  // --- оформлено за период: то, что продавец видит в кабинете ---------------
  //
  // Разбивка целиком достаётся ОСНОВНОМУ набору (profitMainBlock), оценка
  // калькулятора — только ему же (mainTariffEstimate).
  const placedIsMain = profitMainBlock(report) === 'placed';
  const estimate = mainTariffEstimate(report);

  if (placedIsMain) {
    lines.push(...detailedBlock(placed, 'placed', estimate), PLACED_IN_TRANSIT_NOTE);
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
        OTHER_ORDERS_NOTE,
      );
    } else {
      lines.push(...detailedBlock(totals, 'redeemed', estimate));
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
  const excluded = profitExcluded(report);

  if (excluded.orders) {
    lines.push('');

    // Молчать здесь нельзя: без этой строки прибыль по части заказов просто
    // исчезла бы из отчёта, а выглядело бы это как «продали мало».
    lines.push(
      `⚠️ Не учтено заказов: ${b(excluded.orders)} ` +
        `на ${b(formatRubles(excluded.revenue))} — нет закупочной цены.`,
    );

    for (const sku of excluded.skus.slice(0, UNKNOWN_PREVIEW)) {
      lines.push(`• ${code(sku)}`);
    }
    if (excluded.skus.length > UNKNOWN_PREVIEW) {
      lines.push(`…и ещё ${excluded.skus.length - UNKNOWN_PREVIEW}`);
    }

    lines.push(UNKNOWN_SKUS_ADVICE);
  }

  lines.push('');

  const rates = placed?.rates ?? totals.rates;

  // Скидки печатаются рядом с датой прайса: закуп — не то, что стоит в файле, и
  // продавец должен видеть, из чего он получен, иначе сумма выглядит взятой
  // с потолка.
  lines.push(
    report.pricesUpdatedAt
      ? `💵 Закуп: ${esc(purchaseBasisText(report.pricesUpdatedAt, rates))}`
      : `💵 ${NO_PRICES_TEXT}`,
  );

  // Ставки продвижения — тем же принципом, что скидки выше.
  const promo = promoParts(rates);
  if (promo.length) {
    lines.push(`📣 Продвижение: ${esc(promo.join(', '))}.`);
  }

  return lines.join('\n');
}
