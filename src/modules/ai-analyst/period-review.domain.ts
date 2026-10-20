/**
 * «ИИ-разбор периода» (TASK-150): факты месяца, кандидаты рекомендаций, промпт
 * и проверка ответа. Чистые функции — без Nest, базы и Polza.
 *
 * Считает сервер, модель только объясняет (решения `ai_explains_not_computes`,
 * `ai_period_review_server_facts`). Сколько заработано и удержано, какие статьи
 * выросли, что подозрительно, какие товары убыточны и почему изменились
 * выплаты — всё готовыми числами с дельтами, у каждого блока свои ссылки.
 * Рекомендации — тоже кандидаты сервера с метками `R1…`: модель на них только
 * ссылается, а экран рисует карточки из кандидатов, поэтому рекомендации без
 * данных быть не может по построению.
 *
 * Блок фактов — `IAiToolInvocation`: так `verifyAnswer`, `sourcesOf` и `gapsOf`
 * «ИИ-аналитика» работают с разбором без второй копии.
 */

import type { IAnalystSource, IAnswerVerification } from './ai-analyst.domain';
import type { IFinanceAnomalyRow } from '../../database/postgres/repositories/finance-anomaly.repository';
import type { IAiToolInvocation, IAiToolResult } from '../ai/ai-tools.types';
import type { IPolzaMessage } from '../ai/polza.client';
import type { IAiMoney } from '../ai-tools/ai-tools.domain';
import type { IPayoutArticle } from '../finance/cashflow';
import type { TFinanceArticle } from '../finance/finance-articles';
import type { IFinanceScreenMonth } from '../finance/finance-screen';
import type { IPnlCompareReport, IPnlReport } from '../finance/finance.service';
import type { IPnlSku } from '../finance/pnl-sku';

import { FINANCE_MARKETPLACES } from '../../database/postgres/finance.schema';
import { unconfirmedSummary } from '../../shared/profit-confirmation';
import {
  AI_TOOL,
  anomaliesResult,
  compareResult,
  money,
  pnlInsufficiency,
  skuResult,
  sourceRefs,
} from '../ai-tools/ai-tools.domain';
import { FINANCE_ARTICLE_KEYS, FINANCE_ARTICLE_META } from '../finance/finance-articles';
import { minPriceOf } from '../finance/pnl-sku';
import { formatRubles } from '../yandex/reports/money';

import { sourcesOf, verifyAnswer } from './ai-analyst.domain';

/**
 * Пороги разбора — одно место, у каждого числа причина. Стартовые, на живых
 * данных не калибровались (known-gaps).
 */
export const REVIEW_THRESHOLDS = {
  /** Статья «изменилась», если сдвиг не меньше 1 000 ₽ — мелочь не стоит строки разбора… */
  articleDeltaKopecks: 100_000,
  /** …и не меньше 10 % от прошлого месяца: у статьи на миллион 1 000 ₽ — шум. */
  articleDeltaRatio: 0.1,
  /** Статей в разборе: больше модель не перескажет, а продавец не прочтёт. */
  maxArticles: 8,
  /** Статей в объяснении выплат. */
  maxPayoutArticles: 6,
  /** Убыточных товаров в фактах — самые убыточные первыми. */
  maxLossSkus: 10,
  /** Рекомендаций — столько карточек на экране. */
  maxRecommendations: 5,
  /** Аномалий в фактах — потолок инструмента «ИИ-аналитика». */
  maxAnomalies: 20,
} as const;

export const REVIEW_NO_PREVIOUS_TEXT =
  'За прошлый месяц журнала нет — сравнить статьи и выплаты не с чем';
export const REVIEW_NO_RECOMMENDATIONS_TEXT =
  'Рекомендаций нет: ни один товар с подтверждённым закупом не продаётся ниже минимальной цены';
export const REVIEW_EMPTY_ANSWER_TEXT = 'Модель не написала разбор — попробуйте ещё раз.';

/** Имена блоков фактов (поле `name` invocation). */
export const REVIEW_BLOCK = {
  TOTALS: 'review:totals',
  ARTICLE: 'review:article',
  ANOMALIES: AI_TOOL.ANOMALIES,
  LOSS_SKU: AI_TOOL.SKU,
  PAYOUTS: 'review:payouts',
  RECOMMENDATION: 'review:recommendation',
  MARKETPLACES: AI_TOOL.COMPARE,
} as const;

// ── Входы ──────────────────────────────────────────────────────────────────

export interface IPeriodReviewInput {
  month: IFinanceScreenMonth;
  previousMonth: IFinanceScreenMonth;
  current: IPnlReport;
  /** null — журнала за прошлый месяц нет (или пуст): сравнивать не с чем. */
  previous: IPnlReport | null;
  payouts: { current: IPayoutArticle[]; previous: IPayoutArticle[] | null };
  anomalies: {
    items: IFinanceAnomalyRow[];
    total: number;
    unreviewed: number;
    checkedAt: Date | null;
  };
  /** Названия товаров по артикулу ЯМ. */
  names: ReadonlyMap<string, string>;
  /** Площадки рядом — `FinanceService.compare` за месяц, как экран «Сравнение площадок» (TASK-173). */
  compare: IPnlCompareReport;
}

export type TRecommendationKind = 'below_min_price';

export interface IReviewRecommendation {
  /** «R1» — метка, по которой модель на неё ссылается. */
  id: string;
  kind: TRecommendationKind;
  sku: string;
  name: string | null;
  /** Средняя цена продажи штуки (выручка с возвратами / штуки), копейки. */
  avgPriceKopecks: number;
  /** Цена штуки при прибыли 0 — `minPriceOf` юнит-экономики, копейки. */
  minPriceKopecks: number;
  /** Чистая товара за месяц, копейки (< 0). */
  netKopecks: number;
  units: number;
  /** Схемы, по которым товар продавался (FBS, FBY…). */
  schemes: string[];
  /** Готовая фраза для карточки — те же числа, что в фактах. */
  text: string;
  /** Ссылка на строки журнала товара. */
  source: IAnalystSource;
}

export interface IPeriodReviewFacts {
  /** Блоки фактов — их получает модель и по ним сверяются числа ответа. */
  blocks: IAiToolInvocation[];
  recommendations: IReviewRecommendation[];
  /** Чего не хватило — печатается экраном отдельно от текста. */
  gaps: string[];
}

// ── Факты ──────────────────────────────────────────────────────────────────

export const factBlock = (
  name: string,
  result: IAiToolResult,
  args: object = {},
): IAiToolInvocation => ({
  name,
  arguments: JSON.stringify(args),
  result,
});

export const delta = (current: number, previous: number | null): IAiMoney | null =>
  previous === null ? null : money(current - previous);

/** Изменение в процентах от модуля прошлого; null — базы нет. */
export const changePercent = (current: number, previous: number | null): number | null =>
  previous === null || previous === 0
    ? null
    : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;

export const rub = (kopecks: number): string => formatRubles(kopecks / 100);

export function levelsOf(report: IPnlReport) {
  const { pnl } = report;
  return {
    revenue: pnl.revenueKopecks,
    otherIncome: pnl.otherIncomeKopecks,
    cogs: pnl.cogs.kopecks,
    marketplaceExpenses: pnl.marketplaceKopecks,
    operatingExpenses: pnl.operatingExpenses.totalKopecks,
    tax: pnl.tax.taxKopecks,
    net: pnl.netKopecks,
  };
}

export function allIds(report: IPnlReport): string[][] {
  return FINANCE_ARTICLE_KEYS.map((key) => report.pnl.byArticle[key].operationIds);
}

/** Сколько заработано и удержано: уровни месяца, прошлого и сдвиг. */
function totalsBlock(input: IPeriodReviewInput): IAiToolInvocation {
  const { current, previous, month, previousMonth } = input;
  const cur = levelsOf(current);
  const prev = previous ? levelsOf(previous) : null;
  const levels = Object.fromEntries(
    (Object.keys(cur) as (keyof typeof cur)[]).map((key) => [
      key,
      {
        current: money(cur[key]),
        previous: prev ? money(prev[key]) : null,
        change: delta(cur[key], prev?.[key] ?? null),
        changePercent: changePercent(cur[key], prev?.[key] ?? null),
      },
    ]),
  );
  return factBlock(REVIEW_BLOCK.TOTALS, {
    ok: true,
    data: {
      month: month.month,
      previousMonth: previous ? previousMonth.month : null,
      statusLabel: current.statusLabel,
      /** false — закупа нет у части проданного: себестоимость занижена, чистая завышена. */
      costComplete: current.pnl.unconfirmed.confirmed,
      revenueWithoutCost: money(current.pnl.unconfirmed.revenueKopecks),
      taxIsDefault: current.taxIsDefault,
      ordersCount: current.pnl.ordersCount,
      units: current.pnl.units,
      levels,
    },
    sourceRefs: {
      ...sourceRefs('finance:pnl', current.pnl.period, allIds(current)),
      label: `P&L за ${month.month}`,
    },
  });
}

/**
 * Статьи, сдвинувшиеся заметно (оба порога `REVIEW_THRESHOLDS`). Знак журнала:
 * доходы «+», расходы «−», поэтому рост расхода — отрицательная дельта.
 */
export function articleChangesOf(
  current: IPnlReport,
  previous: IPnlReport,
): { article: TFinanceArticle; current: number; previous: number; delta: number }[] {
  return FINANCE_ARTICLE_KEYS.filter((key) => FINANCE_ARTICLE_META[key].group !== 'reference')
    .map((article) => {
      const cur = current.pnl.byArticle[article].kopecks;
      const prev = previous.pnl.byArticle[article].kopecks;
      return { article, current: cur, previous: prev, delta: cur - prev };
    })
    .filter(
      (row) =>
        Math.abs(row.delta) >= REVIEW_THRESHOLDS.articleDeltaKopecks &&
        (row.previous === 0 ||
          Math.abs(row.delta) / Math.abs(row.previous) >= REVIEW_THRESHOLDS.articleDeltaRatio),
    )
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.article.localeCompare(b.article))
    .slice(0, REVIEW_THRESHOLDS.maxArticles);
}

/** Знак журнала словами: расход «−», поэтому его рост — отрицательная дельта. */
export function directionOf(expense: boolean, change: number): string {
  if (expense) return change < 0 ? 'расход вырос' : 'расход снизился';
  return change > 0 ? 'доход вырос' : 'доход снизился';
}

function articleBlocks(input: IPeriodReviewInput): IAiToolInvocation[] {
  if (!input.previous) return [];
  const { current, previous, month } = input;
  return articleChangesOf(current, previous).map((row) => {
    const meta = FINANCE_ARTICLE_META[row.article];
    const expense = meta.group === 'expense';
    return factBlock(
      REVIEW_BLOCK.ARTICLE,
      {
        ok: true,
        data: {
          article: row.article,
          title: meta.title,
          group: meta.group,
          current: money(row.current),
          previous: money(row.previous),
          change: money(row.delta),
          changePercent: changePercent(row.current, row.previous),
          /** Словами — модели не надо разбирать знак журнала. */
          direction: directionOf(expense, row.delta),
          operationCount: current.pnl.byArticle[row.article].operationIds.length,
        },
        sourceRefs: {
          ...sourceRefs('finance:pnl', current.pnl.period, [
            current.pnl.byArticle[row.article].operationIds,
          ]),
          label: `Статья «${meta.title}» за ${month.month}`,
        },
      },
      { article: row.article },
    );
  });
}

/** Подозрительные списания — непросмотренные аномалии детектора (TASK-149). */
function anomaliesBlock(input: IPeriodReviewInput): IAiToolInvocation {
  const unreviewed = input.anomalies.items.filter((a) => !a.reviewed);
  const result = anomaliesResult({
    month: input.month,
    ...input.anomalies,
    items: unreviewed.slice(0, REVIEW_THRESHOLDS.maxAnomalies),
  });
  if (result.ok) result.sourceRefs.label = `Аномалии за ${input.month.month}`;
  return factBlock(REVIEW_BLOCK.ANOMALIES, result, { month: input.month.month });
}

/** Убыточные товары с подтверждённым закупом — самые убыточные первыми. */
export function lossSkusOf(report: IPnlReport): IPnlSku[] {
  return report.pnl.skus.skus
    .filter((sku) => sku.costKnown && sku.netKopecks < 0)
    .sort((a, b) => a.netKopecks - b.netKopecks || a.sku.localeCompare(b.sku))
    .slice(0, REVIEW_THRESHOLDS.maxLossSkus);
}

function lossSkuBlocks(input: IPeriodReviewInput): IAiToolInvocation[] {
  return lossSkusOf(input.current).map((sku) =>
    factBlock(
      REVIEW_BLOCK.LOSS_SKU,
      skuResult(input.current, sku.sku, input.names.get(sku.sku) ?? null),
      {
        sku: sku.sku,
      },
    ),
  );
}

/** Почему изменились выплаты: Σ по статьям обоих месяцев и сдвиг каждой. */
function payoutsBlock(input: IPeriodReviewInput): IAiToolInvocation {
  const { current, previous } = input.payouts;
  const sum = (rows: IPayoutArticle[]) => rows.reduce((s, r) => s + r.kopecks, 0);
  const prevBy = new Map((previous ?? []).map((r) => [r.article, r.kopecks]));
  const articles = new Set<TFinanceArticle>([
    ...current.map((r) => r.article),
    ...(previous ?? []).map((r) => r.article),
  ]);
  const curBy = new Map(current.map((r) => [r.article, r.kopecks]));
  const changes = [...articles]
    .map((article) => {
      const cur = curBy.get(article) ?? 0;
      const prev = previous ? (prevBy.get(article) ?? 0) : null;
      return {
        article,
        title: FINANCE_ARTICLE_META[article].title,
        current: money(cur),
        previous: prev === null ? null : money(prev),
        change: delta(cur, prev),
        sort: prev === null ? Math.abs(cur) : Math.abs(cur - prev),
      };
    })
    .sort((a, b) => b.sort - a.sort || a.article.localeCompare(b.article))
    .slice(0, REVIEW_THRESHOLDS.maxPayoutArticles)
    .map(({ sort: _sort, ...row }) => row);
  const total = sum(current);
  const prevTotal = previous ? sum(previous) : null;
  return factBlock(REVIEW_BLOCK.PAYOUTS, {
    ok: true,
    data: {
      month: input.month.month,
      /** Σ денежных строк выплаченных в месяце поручений. */
      paid: money(total),
      previousPaid: prevTotal === null ? null : money(prevTotal),
      change: delta(total, prevTotal),
      changePercent: changePercent(total, prevTotal),
      byArticle: changes,
    },
    sourceRefs: {
      ...sourceRefs(
        'finance:payouts',
        input.month.period,
        current.map((r) => r.operationIds),
      ),
      label: `Выплаты за ${input.month.month}`,
    },
  });
}

/**
 * Кандидаты рекомендаций — только из юнит-экономики (решение
 * `ai_period_review_server_facts`): убыточный товар с подтверждённым закупом,
 * средняя цена которого ниже минимальной. Возвраты и схема уже внутри: выручка
 * товара — продажи минус возвраты, логистика — с обратной, по его схемам.
 * Сравнение площадок даёт кандидата, только когда у площадки есть журнал —
 * сейчас его нет ни у Ozon, ни у WB, и это уходит в пробелы.
 */
export function recommendationsOf(input: IPeriodReviewInput): IReviewRecommendation[] {
  const result: IReviewRecommendation[] = [];
  for (const sku of lossSkusOf(input.current)) {
    if (result.length >= REVIEW_THRESHOLDS.maxRecommendations) break;
    const min = minPriceOf(sku);
    if (min === null || !(sku.units > 0)) continue;
    const avg = Math.round(sku.columns.revenue / sku.units);
    if (avg >= min) continue;
    const id = `R${result.length + 1}`;
    const name = input.names.get(sku.sku) ?? null;
    const sources = sourcesOf([
      factBlock(REVIEW_BLOCK.LOSS_SKU, skuResult(input.current, sku.sku, name), { sku: sku.sku }),
    ]);
    if (!sources.length) continue;
    result.push({
      id,
      kind: 'below_min_price',
      sku: sku.sku,
      name,
      avgPriceKopecks: avg,
      minPriceKopecks: min,
      netKopecks: sku.netKopecks,
      units: sku.units,
      schemes: sku.schemes.map((s) => s.scheme).filter((s): s is string => Boolean(s)),
      text:
        `Средняя цена ${rub(avg)} ниже минимальной ${rub(min)} — на ${rub(min - avg)} за штуку; ` +
        `за месяц товар дал ${rub(sku.netKopecks)} чистой. Поднимите цену или пересмотрите закуп и логистику.`,
      source: sources[0],
    });
  }
  return result;
}

function recommendationBlocks(recommendations: IReviewRecommendation[]): IAiToolInvocation[] {
  return recommendations.map((r) =>
    factBlock(
      REVIEW_BLOCK.RECOMMENDATION,
      {
        ok: true,
        data: {
          id: r.id,
          kind: r.kind,
          sku: r.sku,
          name: r.name,
          schemes: r.schemes,
          units: r.units,
          avgPrice: money(r.avgPriceKopecks),
          minPrice: money(r.minPriceKopecks),
          gapPerUnit: money(r.minPriceKopecks - r.avgPriceKopecks),
          net: money(r.netKopecks),
        },
        sourceRefs: {
          source: r.source.source,
          period: r.source.period ?? undefined,
          operationIds: r.source.operationIds,
          operationCount: r.source.operationCount,
          label: `${r.id}: ${r.source.label}`,
        },
      },
      { id: r.id },
    ),
  );
}

/**
 * Факты разбора. Строка — журнала за месяц нет (или он пуст): модель не зовётся вовсе, экран
 * печатает причину (строк `AiUsage` нет).
 */
export function periodReviewFacts(input: IPeriodReviewInput): IPeriodReviewFacts | string {
  const missing = pnlInsufficiency(input.current);
  if (missing) return missing;

  const gaps: string[] = [];
  if (!input.previous) gaps.push(REVIEW_NO_PREVIOUS_TEXT);
  const unconfirmed = unconfirmedSummary(input.current.pnl.unconfirmed, rub);
  if (unconfirmed) gaps.push(unconfirmed);

  const recommendations = recommendationsOf(input);
  if (!recommendations.length) gaps.push(REVIEW_NO_RECOMMENDATIONS_TEXT);

  const blocks = [
    totalsBlock(input),
    ...articleBlocks(input),
    anomaliesBlock(input),
    ...lossSkuBlocks(input),
    payoutsBlock(input),
    ...recommendationBlocks(recommendations),
    // Площадка закрыта или без журнала — её причину соберёт gapsOf.
    factBlock(REVIEW_BLOCK.MARKETPLACES, compareResult(FINANCE_MARKETPLACES, input.compare), {}),
  ];
  return { blocks, recommendations, gaps };
}

// ── Промпт ─────────────────────────────────────────────────────────────────

export function periodReviewPrompt(): string {
  return [
    'Ты — финансовый аналитик продавца маркетплейсов. Разбери месяц по фактам ниже. По-русски, коротко.',
    'Структура: 1) сколько заработано и удержано (уровни из review:totals); 2) какие статьи ' +
      'изменились (review:article); 3) подозрительные списания (listAnomalies); 4) убыточные товары ' +
      '(getSkuEconomics); 5) почему изменились выплаты (review:payouts); 6) рекомендации.',
    'Любое число бери ТОЛЬКО из фактов и пересказывай как есть: рубли — полем rub (можно ' +
      'округлить до целого рубля), проценты — как пришли. Дельты уже посчитаны в полях change и ' +
      'changePercent — сам не складывай, не вычитай, не дели и не пиши «тыс.»/«млн».',
    'Рекомендации — ТОЛЬКО из блоков review:recommendation, каждая со ссылкой на свою метку в ' +
      'квадратных скобках: [R1]. Своих рекомендаций не придумывай. Нет таких блоков — так и скажи.',
    'Если блок insufficientData или прошлого месяца нет — скажи «данных недостаточно» и причину. ' +
      'Не догадывайся и не подставляй ноль.',
    'Если statusLabel говорит, что месяц не проверен, или costComplete = false — оговори это.',
  ].join('\n');
}

/** Блоки фактов для модели: имя блока и его данные или причина отсутствия. */
export function factsPayload(blocks: readonly IAiToolInvocation[]): object[] {
  return blocks.map(({ name, result }) => {
    // strictNullChecks выключен — union не сужается, поля читаются явно.
    const r = result as {
      ok: boolean;
      data?: unknown;
      insufficientData?: boolean;
      reason?: string;
    };
    if (r.ok) return { block: name, data: r.data };
    return { block: name, insufficientData: true, reason: r.reason ?? null };
  });
}

/** Факты — одним сообщением: имя блока и его данные или причина отсутствия. */
export function toReviewMessages(facts: IPeriodReviewFacts, month: string): IPolzaMessage[] {
  const payload = factsPayload(facts.blocks);
  return [
    { role: 'system', content: periodReviewPrompt() },
    {
      role: 'user',
      content: `Разбери месяц ${month}. Факты (JSON):\n${JSON.stringify(payload)}`,
    },
  ];
}

// ── Проверка ответа ────────────────────────────────────────────────────────

/** Метки рекомендаций в тексте: «[R1]», «[R2, R3]». */
export function recommendationTagsOf(answer: string): string[] {
  const tags = new Set<string>();
  for (const group of answer.matchAll(/\[([^\]]*)\]/g))
    for (const tag of group[1].matchAll(/\bR(\d+)\b/g)) tags.add(`R${tag[1]}`);
  return [...tags];
}

/**
 * Сверка разбора: числа — `verifyAnswer` по блокам фактов, метки — только
 * существующих кандидатов. Чужая метка — рекомендация, которой сервер не
 * выводил: в неподтверждённые, как выдуманное число.
 */
export function verifyReview(
  answer: string,
  month: string,
  facts: IPeriodReviewFacts,
): IAnswerVerification {
  const numbers = verifyAnswer(answer, month, facts.blocks);
  const known = new Set(facts.recommendations.map((r) => r.id));
  const strangers = recommendationTagsOf(answer)
    .filter((tag) => !known.has(tag))
    .map((tag) => `[${tag}]`);
  const unconfirmed = [...numbers.unconfirmed, ...strangers];
  return { verified: !unconfirmed.length, unconfirmed };
}
