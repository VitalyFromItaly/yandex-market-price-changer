import type { IChatCompletionRequest, IChatCompletionResult, IPolzaBalance } from './polza.client';
import type { IAiUsageRow } from '../../database/services/ai-usage.service';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { AiUsageService } from '../../database/services/ai-usage.service';
import { ErrorReporter } from '../errors/error-reporter.service';
import { moscowDayStart } from '../yandex/reports/moscow-day';

import {
  AiDailyLimitError,
  AiFeatureDisabledError,
  AiUnavailableError,
  shouldAlertPolzaError,
} from './ai.errors';
import { PolzaClient } from './polza.client';
import { PolzaApiError } from './polza.errors';

export interface IAiContext {
  telegramUserId: string;
  /**
   * Открыта ли продавцу фича `ai` — готовым boolean (админ уже разрешён через
   * allFeaturesEnabled). Сервис UserAccess не читает: реестр фич — бота.
   */
  aiAllowed: boolean;
  /** Где в продукте спросили — для учёта: `feedback-reply`, `check`… */
  purpose: string;
}

/**
 * Единственная точка любого ИИ-функционала.
 *
 * Всё, что может отказать, проверяется ДО HTTP: фича, включён ли ИИ на
 * сервере, дневной лимит. Барьер в сервисе, а не в хендлерах, — довод
 * featureGate: новый хендлер не может его забыть, потому что другой двери к
 * Polza нет (PolzaClient из AiModule не экспортируется).
 *
 * Каждый запрос — успешный и упавший — одна строка AiUsage. Текста промпта и
 * ответа в ней нет.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly polza: PolzaClient,
    private readonly usage: AiUsageService,
    private readonly config: AppConfigService,
    private readonly errors: ErrorReporter,
  ) {}

  public async complete(
    ctx: IAiContext,
    request: IChatCompletionRequest,
    now: Date = new Date(),
  ): Promise<IChatCompletionResult> {
    // Ошибка программиста, а не продавца: учёт и лимит без продавца не работают
    // (довод обязательного telegramUserId в StockSyncService.sync).
    if (!ctx?.telegramUserId) throw new Error('AiService.complete: не передан telegramUserId');
    if (!ctx.purpose) throw new Error('AiService.complete: не передан purpose');

    if (!ctx.aiAllowed) throw new AiFeatureDisabledError();
    if (!this.config.polzaAiEnabled) throw new AiUnavailableError('POLZA_AI_TOKEN не задан');
    await this.assertWithinLimit(ctx.telegramUserId, now);

    const base = {
      telegramUserId: ctx.telegramUserId,
      purpose: ctx.purpose,
      model: request.model ?? this.config.polzaAiModel ?? '',
    };
    const started = Date.now();

    try {
      const result = await this.polza.chatCompletion(request);
      void this.usage.record({
        ...base,
        ...result.usage,
        responseModel: result.model,
        provider: result.provider,
        durationMs: Date.now() - started,
        traceId: result.traceId,
        status: 'ok',
        httpStatus: null,
        errorCode: null,
      });
      return result;
    } catch (error) {
      const api = error instanceof PolzaApiError ? error : undefined;
      void this.usage.record(failedRow(base, Date.now() - started, api));
      void this.errors.report({
        error,
        source: 'polza',
        context: `ai:${ctx.purpose}`,
        telegramUserId: ctx.telegramUserId,
        durationMs: Date.now() - started,
        direction: 'out',
        alert: api ? shouldAlertPolzaError(api) : true,
      });
      throw error;
    }
  }

  /**
   * Баланс Polza — системный запрос самопроверки, не продавца.
   *
   * Без фичи, лимита и строки AiUsage: запрос бесплатный и ничей. Ошибки НЕ
   * репортятся: о балансе судит HealthMonitorService, он пишет журнал с
   * alert: false и шлёт алерт по shouldNotify. Отчёт здесь дал бы вторую
   * запись и алерт мимо этого правила каждые пять минут.
   */
  public async balance(): Promise<IPolzaBalance> {
    if (!this.config.polzaAiEnabled) throw new AiUnavailableError('POLZA_AI_TOKEN не задан');
    return await this.polza.getBalance();
  }

  /**
   * Сумма costRub за московские сутки против лимита.
   *
   * Сумму не узнать — отказ (решение владельца `ai_limit_unknown_refuse`):
   * тратить чужие деньги вслепую нельзя, правило «не знаем = нельзя», как с
   * моделью размещения при записи остатков.
   *
   * Проверка до запроса, а не атомарная бронь: параллельные запросы одного
   * продавца могут перешагнуть лимит на стоимость одного запроса — копейки.
   */
  private async assertWithinLimit(telegramUserId: string, now: Date): Promise<void> {
    const limit = this.config.aiUserDailyLimitRub;
    if (!(limit > 0)) return;

    let spent: number;
    try {
      spent = await this.usage.spentRubSince(telegramUserId, moscowDayStart(now));
    } catch (error) {
      this.logger.warn(
        `Лимит ИИ для ${telegramUserId} не проверить — отказ: ${(error as Error).message}`,
      );
      throw new AiUnavailableError('не удалось прочитать расход за день');
    }
    if (spent >= limit) throw new AiDailyLimitError(spent, limit);
  }
}

function failedRow(
  base: Pick<IAiUsageRow, 'telegramUserId' | 'purpose' | 'model'>,
  durationMs: number,
  error: PolzaApiError | undefined,
): IAiUsageRow {
  return {
    ...base,
    responseModel: '',
    provider: '',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    // Упавший запрос Polza не тарифицирует.
    costRub: 0,
    durationMs,
    traceId: error?.traceId ?? '',
    status: 'error',
    httpStatus: error?.status || null,
    errorCode: error?.code ?? null,
  };
}
