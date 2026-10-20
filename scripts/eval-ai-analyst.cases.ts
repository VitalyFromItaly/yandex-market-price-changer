import type { IEvalCase } from '../src/modules/ai-analyst/analyst-eval.domain';

/**
 * Контрольный набор вопросов к ИИ-аналитику (TASK-169). Одна строка — один вопрос:
 * какие инструменты обязаны быть вызваны и с какими ключевыми аргументами.
 * Уточняющий вопрос и неподтверждённые числа — провал всегда (кроме allowClarify).
 * Прогон — `scripts/eval-ai-analyst.ts`, правила — README ai-analyst.
 */
// prettier-ignore
export const EVAL_CASES: IEvalCase[] = [
  // Регрессия 18-10-2026: «какой артикул?» по кругу вместо getBrandEconomics.
  { q: 'Сколько я заработал на Casio?', tools: ['getBrandEconomics'], args: { getBrandEconomics: { brand: 'casio' } } },
  { q: 'Сколько заработал на касио в прошлом месяце?', tools: ['getBrandEconomics'], args: { getBrandEconomics: { brand: 'casio' } } },
  { q: 'Какой бренд приносит больше всего прибыли?', tools: ['getBrandEconomics'] },
  { q: 'Как продаётся Восток за последние 30 дней?', tools: ['getBrandEconomics'], args: { getBrandEconomics: { brand: 'vostok' } } },
  { q: 'Сравни Orient и Seiko по чистой прибыли за сентябрь', tools: ['getBrandEconomics'] },
  { q: 'Сколько я заработал в прошлом месяце?', tools: ['getPnl'] },
  { q: 'Какая у меня выручка за сентябрь?', tools: ['getPnl'] },
  { q: 'Почему упала прибыль в прошлом месяце?', tools: ['getPnl'] },
  { q: 'Какая рентабельность за последний квартал?', tools: ['getPnl'] },
  { q: 'Сколько ушло на логистику в сентябре?', tools: ['getPnl'] },
  { q: 'Сколько я заплатил Маркету комиссии за прошлый месяц?', tools: ['getPnl'] },
  { q: 'Какой налог за сентябрь?', tools: ['getPnl'] },
  { q: 'Где больше заработал в прошлом месяце на всех площадках?', tools: ['compareMarketplaces'] },
  { q: 'Сравни площадки за сентябрь', tools: ['compareMarketplaces'] },
  { q: 'Какие товары убыточные?', tools: ['getTopSkus'], args: { getTopSkus: { lossOnly: true } } },
  { q: 'Топ-5 товаров по прибыли за прошлый месяц', tools: ['getTopSkus'], args: { getTopSkus: { by: 'net' } } },
  { q: 'Какие товары продаются лучше всего по штукам?', tools: ['getTopSkus'], args: { getTopSkus: { by: 'units' } } },
  { q: 'У каких товаров самая низкая маржа?', tools: ['getTopSkus'], args: { getTopSkus: { by: 'margin' } } },
  { q: 'Какой товар принёс больше всего выручки в сентябре?', tools: ['getTopSkus'], args: { getTopSkus: { by: 'revenue' } } },
  { q: 'Сколько заработал на F-91W?', tools: ['searchProducts', 'getSkuEconomics'] },
  { q: 'Как продаётся Амфибия?', tools: ['searchProducts'] },
  { q: 'Найди часы Casio G-Shock в моём каталоге', tools: ['searchProducts'] },
  { q: 'Какая экономика у артикула A1 за сентябрь?', tools: ['getSkuEconomics'], args: { getSkuEconomics: { sku: 'A1' } } },
  { q: 'Есть ли аномалии в журнале за сентябрь?', tools: ['listAnomalies'] },
  { q: 'Были ли двойные начисления или штрафы в прошлом месяце?', tools: ['listAnomalies'] },
  { q: 'Какие товары без закупочной цены?', tools: ['listAnomalies'] },
  { q: 'Когда придут деньги?', tools: ['getCashflow'] },
  { q: 'Сколько Маркет ещё мне должен?', tools: ['getCashflow'] },
  { q: 'Сколько Маркет выплатил в сентябре?', tools: ['getCashflow'] },
  { q: 'Какой будет выручка до конца месяца?', tools: ['getForecast'] },
  { q: 'Сколько я заработаю до конца года?', tools: ['getForecast'] },
  { q: 'Сколько налога мне платить за год?', tools: ['getTaxYear'] },
  { q: 'Какой авансовый платёж по УСН за 9 месяцев?', tools: ['getTaxYear'] },
  { q: 'Не превышу ли я лимит УСН в этом году?', tools: ['getTaxYear'] },
  { q: 'По какой цене продавать A1, чтобы зарабатывать 500 рублей со штуки?', tools: ['getPriceFor'], args: { getPriceFor: { sku: 'A1', targetProfitRub: 500 } } },
  { q: 'Какая цена A1 даст рентабельность 20%?', tools: ['getPriceFor'], args: { getPriceFor: { sku: 'A1', targetMarginPercent: 20 } } },
  { q: 'Сколько я потратил на аренду и зарплаты в сентябре?', tools: ['getExpenses'] },
  { q: 'Какие у меня операционные расходы за прошлый месяц?', tools: ['getExpenses'] },
  { q: 'Что из Casio заканчивается?', tools: ['getStocks'], args: { getStocks: { brand: 'casio' } } },
  { q: 'Сколько товаров едет обратно?', tools: ['getReturns'] },
];
