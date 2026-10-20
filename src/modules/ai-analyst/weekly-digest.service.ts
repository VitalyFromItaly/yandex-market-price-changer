import type { IAnswerVerification } from './ai-analyst.domain';
import type { IFinancePeriod } from '../finance/finance-period';
import type { IPnlReport } from '../finance/finance.service';

import { Injectable } from '@nestjs/common';

import { ProductService } from '../../database/services/product.service';
import { AiFeatureDisabledError } from '../ai/ai.errors';
import { AiService } from '../ai/ai.service';
import { pnlInsufficiency } from '../ai-tools/ai-tools.domain';
import { monthsOf } from '../finance/finance-period';
import { parseScreenMonth } from '../finance/finance-screen';
import { FinanceScreenService } from '../finance/finance-screen.service';
import { FinanceService } from '../finance/finance.service';

import { gapsOf } from './ai-analyst.domain';
import { lossSkusOf } from './period-review.domain';
import {
  DIGEST_EMPTY_ANSWER_TEXT,
  lastFullWeek,
  previousWeek,
  toDigestMessages,
  verifyDigest,
  WEEKLY_DIGEST_PURPOSE,
  weeklyDigestFacts,
} from './weekly-digest.domain';

export interface IWeeklyDigestAsk {
  telegramUserId: string;
  /** Открыта ли фича `ai` — готовым boolean (админ уже «всё открыто»). */
  aiAllowed: boolean;
}

export type TWeeklyDigest =
  /** Данных нет — модель не звали, строк `AiUsage` нет. */
  | { kind: 'skipped'; week: IFinancePeriod; reason: string }
  | {
      kind: 'ready';
      week: IFinancePeriod;
      answer: string;
      verification: IAnswerVerification;
      gaps: string[];
    };

/** Строк аномалий за раз — как у разбора периода. */
const ANOMALY_PAGE = 100;

/**
 * Еженедельная ИИ-сводка (TASK-168). Факты — из тех же дверей, что экраны:
 * P&L недели и позапрошлой — `FinanceService.build` (`flat: false`), аномалии —
 * `FinanceScreenService` по месяцам недели. Модель — один запрос без
 * инструментов (факты уже собраны).
 *
 * Отказы `AiService` (лимит, нет токена) и сбои Polza пробрасываются как есть:
 * что с ними делать, решает процессор рассылки.
 */
@Injectable()
export class WeeklyDigestService {
  constructor(
    private readonly ai: AiService,
    private readonly finance: FinanceService,
    private readonly screen: FinanceScreenService,
    private readonly products: ProductService,
  ) {}

  public async build(input: IWeeklyDigestAsk, now = new Date()): Promise<TWeeklyDigest> {
    if (!input.aiAllowed) throw new AiFeatureDisabledError();
    const { telegramUserId: uid } = input;
    const week = lastFullWeek(now);
    const before = previousWeek(week);
    const months = monthsOf(week).map((period) => parseScreenMonth(period.from.slice(0, 7)));

    const [current, previousRaw, ...anomalies] = await Promise.all([
      this.finance.build(uid, week, now, { flat: false }),
      this.finance.build(uid, before, now, { flat: false }),
      ...months.map(async (month) => ({
        month,
        ...(await this.screen.anomalies(uid, month, { limit: ANOMALY_PAGE, unreviewedOnly: true })),
      })),
    ]);
    const previous: IPnlReport | null = pnlInsufficiency(previousRaw) ? null : previousRaw;

    const skus = lossSkusOf(current).map((s) => s.sku);
    const names = new Map(
      (await this.products.findByYmSkus(uid, skus))
        .filter((p) => p.marketplaceSkus?.ym && p.name)
        .map((p) => [p.marketplaceSkus.ym, p.name]),
    );

    const facts = weeklyDigestFacts({
      week,
      previousWeek: before,
      current,
      previous,
      anomalies,
      names,
    });
    if (typeof facts === 'string') return { kind: 'skipped', week, reason: facts };

    const completion = await this.ai.complete(
      { telegramUserId: uid, aiAllowed: input.aiAllowed, purpose: WEEKLY_DIGEST_PURPOSE },
      { messages: toDigestMessages(facts, week) },
      now,
    );
    const answer = completion.content?.trim() || DIGEST_EMPTY_ANSWER_TEXT;
    return {
      kind: 'ready',
      week,
      answer,
      verification: verifyDigest(answer, week, facts),
      gaps: [...facts.gaps, ...gapsOf(facts.blocks)],
    };
  }
}
