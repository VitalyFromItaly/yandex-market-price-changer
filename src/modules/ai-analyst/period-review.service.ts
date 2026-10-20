import type { IAnalystSource, IAnswerVerification } from './ai-analyst.domain';
import type { IReviewRecommendation } from './period-review.domain';
import type { TAiPurpose } from '../ai/ai-purpose';
import type { IFinanceScreenMonth } from '../finance/finance-screen';
import type { IPnlReport } from '../finance/finance.service';
import type { TFeatureKey } from '../telegram/bots/shared/features.domain';

import { Injectable } from '@nestjs/common';

import { AiTurnService } from '../../database/services/ai-turn.service';
import { ProductService } from '../../database/services/product.service';
import { AiFeatureDisabledError } from '../ai/ai.errors';
import { AiService } from '../ai/ai.service';
import { openFinanceMarketplaces, pnlInsufficiency } from '../ai-tools/ai-tools.domain';
import { FinanceCashflowService } from '../finance/finance-cashflow.service';
import { previousScreenMonth } from '../finance/finance-screen';
import { FinanceScreenService } from '../finance/finance-screen.service';
import { FinanceService } from '../finance/finance.service';

import { gapsOf, sourcesOf } from './ai-analyst.domain';
import {
  lossSkusOf,
  periodReviewFacts,
  REVIEW_EMPTY_ANSWER_TEXT,
  toReviewMessages,
  verifyReview,
} from './period-review.domain';
import { turnQualityOf } from './turn-quality.domain';

/** purpose строк AiUsage и AiTurn разбора периода. */
export const PERIOD_REVIEW_PURPOSE: TAiPurpose = 'period-review';

export interface IPeriodReviewAsk {
  telegramUserId: string;
  /** Открыта ли фича `ai` — готовым boolean (админ уже «всё открыто»). */
  aiAllowed: boolean;
  month: IFinanceScreenMonth;
  /**
   * Открытые фичи площадок (`AI_MARKETPLACE_FEATURES`): закрытая площадка в
   * блок сравнения не читается. Не передано — только ЯМ.
   */
  features?: readonly TFeatureKey[];
  /** id хода CRM: счётчики качества — в AiTurn (TASK-170). */
  turnId?: string;
}

export interface IPeriodReview {
  /** «ГГГГ-ММ» разбираемого месяца и базы сравнения. */
  month: string;
  previousMonth: string;
  /** null — модель не звали: журнала за месяц нет. Причина — в `gaps`. */
  answer: string | null;
  verification: IAnswerVerification;
  recommendations: IReviewRecommendation[];
  sources: IAnalystSource[];
  gaps: string[];
}

/** Строк аномалий за раз — столько видит разбор. */
const ANOMALY_PAGE = 100;

/**
 * «ИИ-разбор периода» (TASK-150). Факты — из тех же дверей, что экраны:
 * P&L — `FinanceService.build` (`flat: false`), площадки рядом — `FinanceService.compare`,
 * выплаты — `FinanceCashflowService`,
 * аномалии — `FinanceScreenService`. Модель — один запрос без инструментов:
 * факты уже собраны, цикл инструментов только тратил бы деньги владельца.
 *
 * Отказы `AiService` и сбои Polza пробрасываются как есть (довод «ИИ-аналитика»).
 */
@Injectable()
export class PeriodReviewService {
  constructor(
    private readonly ai: AiService,
    private readonly finance: FinanceService,
    private readonly cashflow: FinanceCashflowService,
    private readonly screen: FinanceScreenService,
    private readonly products: ProductService,
    private readonly turns: AiTurnService,
  ) {}

  public async review(input: IPeriodReviewAsk, now = new Date()): Promise<IPeriodReview> {
    // Закрытый `ai` — до чтения журнала: гейт CRM его уже отсёк, здесь — для других вызывающих.
    if (!input.aiAllowed) throw new AiFeatureDisabledError();
    const { telegramUserId: uid, month } = input;
    const previousMonth = previousScreenMonth(month);

    const open = openFinanceMarketplaces(new Set(input.features ?? []));
    const [current, previousRaw, cashCurrent, cashPrevious, anomalies, compare] = await Promise.all(
      [
        this.finance.build(uid, month.period, now, { flat: false }),
        this.finance.build(uid, previousMonth.period, now, { flat: false }),
        this.cashflow.build(uid, month.period, now),
        this.cashflow.build(uid, previousMonth.period, now),
        this.screen.anomalies(uid, month, { limit: ANOMALY_PAGE, unreviewedOnly: true }),
        this.finance.compare(uid, month.period, open),
      ],
    );
    const previous: IPnlReport | null = pnlInsufficiency(previousRaw) ? null : previousRaw;

    // Названия нужны только товарам, которые попадут в факты, — убыточным.
    const skus = lossSkusOf(current).map((s) => s.sku);
    const names = new Map(
      (await this.products.findByYmSkus(uid, skus))
        .filter((p) => p.marketplaceSkus?.ym && p.name)
        .map((p) => [p.marketplaceSkus.ym, p.name]),
    );

    const facts = periodReviewFacts({
      month,
      previousMonth,
      current,
      previous,
      payouts: {
        current: cashCurrent.cashflow.payoutArticles,
        previous: previous ? cashPrevious.cashflow.payoutArticles : null,
      },
      anomalies,
      names,
      compare,
    });
    const base = { month: month.month, previousMonth: previousMonth.month };
    if (typeof facts === 'string') {
      return {
        ...base,
        answer: null,
        verification: { verified: true, unconfirmed: [] },
        recommendations: [],
        sources: [],
        gaps: [facts],
      };
    }

    const completion = await this.ai.complete(
      { telegramUserId: uid, aiAllowed: input.aiAllowed, purpose: PERIOD_REVIEW_PURPOSE },
      { messages: toReviewMessages(facts, month.month) },
      now,
    );
    const answer = completion.content?.trim() || REVIEW_EMPTY_ANSWER_TEXT;
    const verification = verifyReview(answer, month.month, facts);
    if (input.turnId) {
      // Один запрос без инструментов: факты собраны заранее, toolCalls — 0.
      await this.turns.record({
        turnId: input.turnId,
        telegramUserId: uid,
        purpose: PERIOD_REVIEW_PURPOSE,
        ...turnQualityOf({
          answer,
          question: month.month,
          verification,
          toolResults: [],
          rounds: 1,
        }),
      });
    }
    return {
      ...base,
      answer,
      verification,
      recommendations: facts.recommendations,
      sources: sourcesOf(facts.blocks),
      gaps: [...facts.gaps, ...gapsOf(facts.blocks)],
    };
  }
}
