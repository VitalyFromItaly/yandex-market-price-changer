/**
 * Еженедельная ИИ-сводка в Telegram (TASK-168): неделя, факты, промпт и сверка
 * ответа. Чистые функции — без Nest, базы и Polza.
 *
 * Тот же порядок, что у «ИИ-разбора периода» (решения `ai_explains_not_computes`,
 * `ai_period_review_server_facts`): числа считает сервер — P&L недели и
 * позапрошлой из `FinanceService.build`, статьи со сдвигом выше порогов
 * `REVIEW_THRESHOLDS`, непросмотренные аномалии месяцев недели, убыточные
 * товары; модель только пересказывает их в 5–7 строк одним запросом без
 * инструментов. Блоки — общие с разбором (`factBlock`, `articleChangesOf`,
 * `lossSkusOf`), своей формулы здесь нет.
 */

import type { IAnswerVerification } from './ai-analyst.domain';
import type { IFinanceAnomalyRow } from '../../database/postgres/repositories/finance-anomaly.repository';
import type { TAiPurpose } from '../ai/ai-purpose';
import type { IAiToolInvocation } from '../ai/ai-tools.types';
import type { IPolzaMessage } from '../ai/polza.client';
import type { IFinancePeriod } from '../finance/finance-period';
import type { IFinanceScreenMonth } from '../finance/finance-screen';
import type { IPnlReport } from '../finance/finance.service';

import { unconfirmedSummary } from '../../shared/profit-confirmation';
import {
  anomaliesResult,
  money,
  pnlInsufficiency,
  skuResult,
  sourceRefs,
} from '../ai-tools/ai-tools.domain';
import { FINANCE_ARTICLE_META } from '../finance/finance-articles';
import { financeToday, shiftDay } from '../finance/finance-period';
import { moscowWeekday } from '../yandex/reports/moscow-day';

import { verifyAnswer } from './ai-analyst.domain';
import {
  allIds,
  articleChangesOf,
  changePercent,
  delta,
  directionOf,
  factBlock,
  factsPayload,
  levelsOf,
  lossSkusOf,
  REVIEW_BLOCK,
  REVIEW_THRESHOLDS,
  rub,
} from './period-review.domain';

/** purpose запроса в `AiUsage` — по нему видно траты на сводку отдельно от экранов. */
export const WEEKLY_DIGEST_PURPOSE: TAiPurpose = 'weekly-digest';

/** Убыточных товаров в сводке: в 5–7 строк больше не поместится. */
export const DIGEST_MAX_LOSS_SKUS = 5;

export const DIGEST_NO_JOURNAL_TEXT =
  'Журнал операций за часть недели не загружен — сводка не строится, чтобы не выдать пропуск за нули';
export const DIGEST_NO_PREVIOUS_TEXT = 'За позапрошлую неделю операций нет — сравнивать не с чем';
export const DIGEST_EMPTY_ANSWER_TEXT = 'Модель не написала сводку.';

export const DIGEST_BLOCK = { TOTALS: 'digest:totals', ARTICLE: REVIEW_BLOCK.ARTICLE } as const;

// ── Неделя ─────────────────────────────────────────────────────────────────

/**
 * Прошлая полная неделя пн–вс по Москве. Понедельник 00:30 МСК — это ещё
 * воскресенье по UTC, поэтому день берётся по Москве, а не из `now`.
 */
export function lastFullWeek(now: Date = new Date()): IFinancePeriod {
  const today = financeToday(now);
  const [year, month, day] = today.split('-').map(Number);
  const from = shiftDay(today, -(moscowWeekday({ year, month, day }) - 1) - 7);
  return { from, to: shiftDay(from, 6) };
}

/** Неделя перед данной — база сравнения. */
export function previousWeek(week: IFinancePeriod): IFinancePeriod {
  return { from: shiftDay(week.from, -7), to: shiftDay(week.to, -7) };
}

/** «12.10–18.10.2026» — как неделя подписана в сообщении. */
export function weekLabel(week: IFinancePeriod): string {
  const [fy, fm, fd] = week.from.split('-');
  const [ty, tm, td] = week.to.split('-');
  return `${fd}.${fm}${fy === ty ? '' : `.${fy}`}–${td}.${tm}.${ty}`;
}

// ── Факты ──────────────────────────────────────────────────────────────────

export interface IWeeklyAnomalies {
  month: IFinanceScreenMonth;
  items: IFinanceAnomalyRow[];
  total: number;
  unreviewed: number;
  checkedAt: Date | null;
}

export interface IWeeklyDigestInput {
  week: IFinancePeriod;
  previousWeek: IFinancePeriod;
  current: IPnlReport;
  /** null — журнала за позапрошлую неделю нет (или пуст). */
  previous: IPnlReport | null;
  /** Аномалии месяцев, которые задевает неделя: детектор помесячный. */
  anomalies: IWeeklyAnomalies[];
  /** Названия товаров по артикулу ЯМ. */
  names: ReadonlyMap<string, string>;
}

export interface IWeeklyDigestFacts {
  blocks: IAiToolInvocation[];
  gaps: string[];
}

function totalsBlock(input: IWeeklyDigestInput): IAiToolInvocation {
  const { current, previous, week } = input;
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
  return factBlock(DIGEST_BLOCK.TOTALS, {
    ok: true,
    data: {
      week,
      previousWeek: previous ? input.previousWeek : null,
      statusLabel: current.statusLabel,
      /** false — закупа нет у части проданного: себестоимость занижена, чистая завышена. */
      costComplete: current.pnl.unconfirmed.confirmed,
      revenueWithoutCost: money(current.pnl.unconfirmed.revenueKopecks),
      ordersCount: current.pnl.ordersCount,
      units: current.pnl.units,
      levels,
    },
    sourceRefs: {
      ...sourceRefs('finance:pnl', current.pnl.period, allIds(current)),
      label: `P&L за ${weekLabel(week)}`,
    },
  });
}

function articleBlocks(input: IWeeklyDigestInput): IAiToolInvocation[] {
  const { current, previous, week } = input;
  if (!previous) return [];
  return articleChangesOf(current, previous).map((row) => {
    const meta = FINANCE_ARTICLE_META[row.article];
    return factBlock(
      DIGEST_BLOCK.ARTICLE,
      {
        ok: true,
        data: {
          article: row.article,
          title: meta.title,
          current: money(row.current),
          previous: money(row.previous),
          change: money(row.delta),
          changePercent: changePercent(row.current, row.previous),
          direction: directionOf(meta.group === 'expense', row.delta),
        },
        sourceRefs: {
          ...sourceRefs('finance:pnl', current.pnl.period, [
            current.pnl.byArticle[row.article].operationIds,
          ]),
          label: `Статья «${meta.title}» за ${weekLabel(week)}`,
        },
      },
      { article: row.article },
    );
  });
}

function anomalyBlocks(input: IWeeklyDigestInput): IAiToolInvocation[] {
  return input.anomalies.map((month) => {
    const result = anomaliesResult({
      ...month,
      items: month.items.filter((a) => !a.reviewed).slice(0, REVIEW_THRESHOLDS.maxAnomalies),
    });
    if (result.ok) result.sourceRefs.label = `Аномалии за ${month.month.month}`;
    return factBlock(REVIEW_BLOCK.ANOMALIES, result, { month: month.month.month });
  });
}

function lossSkuBlocks(input: IWeeklyDigestInput): IAiToolInvocation[] {
  return lossSkusOf(input.current)
    .slice(0, DIGEST_MAX_LOSS_SKUS)
    .map((sku) =>
      factBlock(
        REVIEW_BLOCK.LOSS_SKU,
        skuResult(input.current, sku.sku, input.names.get(sku.sku) ?? null),
        { sku: sku.sku },
      ),
    );
}

/**
 * Факты сводки. Строка — данных нет: журнал хоть одного месяца недели не
 * загружен (неполная неделя выглядела бы падением) или за неделю нет операций.
 * Тогда модель не зовётся и сообщение не уходит.
 */
export function weeklyDigestFacts(input: IWeeklyDigestInput): IWeeklyDigestFacts | string {
  if (input.current.months.some((month) => month.status === null)) return DIGEST_NO_JOURNAL_TEXT;
  const missing = pnlInsufficiency(input.current);
  if (missing) return missing;

  const gaps: string[] = [];
  if (!input.previous) gaps.push(DIGEST_NO_PREVIOUS_TEXT);
  const unconfirmed = unconfirmedSummary(input.current.pnl.unconfirmed, rub);
  if (unconfirmed) gaps.push(unconfirmed);

  return {
    blocks: [
      totalsBlock(input),
      ...articleBlocks(input),
      ...anomalyBlocks(input),
      ...lossSkuBlocks(input),
    ],
    gaps,
  };
}

// ── Промпт и сверка ────────────────────────────────────────────────────────

export function weeklyDigestPrompt(): string {
  return [
    'Ты — финансовый аналитик продавца маркетплейсов. Напиши сводку прошлой недели по фактам ниже: ' +
      '5–7 коротких строк по-русски, простым текстом без разметки.',
    'Порядок: выручка и чистая прибыль и их сдвиг к позапрошлой неделе (digest:totals); статьи, ' +
      'которые заметно изменились (review:article); непросмотренные подозрительные списания ' +
      '(listAnomalies); убыточные товары (getSkuEconomics).',
    'Любое число бери ТОЛЬКО из фактов и пересказывай как есть: рубли — полем rub (можно ' +
      'округлить до целого рубля), проценты — как пришли. Сам не складывай, не вычитай, не дели ' +
      'и не пиши «тыс.»/«млн».',
    'Если блок insufficientData или позапрошлой недели нет — скажи об этом. Не подставляй ноль.',
    'Если statusLabel говорит, что данные предварительные, или costComplete = false — оговори это.',
  ].join('\n');
}

/** Вопрос модели — его даты `verifyAnswer` не считает выдуманными числами. */
export function digestQuestion(week: IFinancePeriod): string {
  return `Сводка за неделю ${weekLabel(week)} (${week.from} — ${week.to}).`;
}

export function toDigestMessages(facts: IWeeklyDigestFacts, week: IFinancePeriod): IPolzaMessage[] {
  return [
    { role: 'system', content: weeklyDigestPrompt() },
    {
      role: 'user',
      content: `${digestQuestion(week)} Факты (JSON):\n${JSON.stringify(factsPayload(facts.blocks))}`,
    },
  ];
}

export function verifyDigest(
  answer: string,
  week: IFinancePeriod,
  facts: IWeeklyDigestFacts,
): IAnswerVerification {
  return verifyAnswer(answer, digestQuestion(week), facts.blocks);
}
