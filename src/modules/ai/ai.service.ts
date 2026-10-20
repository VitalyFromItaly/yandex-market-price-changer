import type {
  IAiToolbox,
  IAiToolInvocation,
  IAiToolResult,
  IAiToolsCompletion,
} from './ai-tools.types';
import type {
  IChatCompletionRequest,
  IChatCompletionResult,
  IPolzaBalance,
  IPolzaCallOptions,
  IPolzaMessage,
  IPolzaToolCall,
} from './polza.client';
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

/**
 * Раундов с инструментами до принудительного текстового ответа. Каждый раунд —
 * оплаченный запрос; модель, которая зовёт инструменты по кругу, иначе тратила
 * бы деньги владельца без ответа продавцу.
 */
export const MAX_TOOL_ROUNDS = 4;
/** Вызовов в одном раунде; лишним уходит ошибка, а не исполнение. */
export const MAX_TOOL_CALLS_PER_ROUND = 8;
/**
 * Потолок времени инструментов одного раунда (TASK-166, решение
 * `ai_tool_round_timeout`). Журнальные инструменты укладываются в доли секунды,
 * а живые (`getStocks`, `getReturns`) ходят в Partner API: отчёт FBY ждётся до
 * минут, квота отвечает паузой. Продавец ждёт ответа в чате, поэтому сверх
 * потолка модель получает честный отказ, а не висящий ход. Сам запрос не
 * отменяется: мемо и single-flight `FbyStockService` подхватят его при повторе.
 */
export const AI_TOOL_ROUND_TIMEOUT_MS = 60_000;
export const TOOL_TIMEOUT_TEXT =
  `Нет ответа за ${AI_TOOL_ROUND_TIMEOUT_MS / 1000} с — данные сейчас недоступны, ` +
  'скажи об этом и предложи повторить вопрос позже';

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
      // Модель по назначению (POLZA_AI_MODELS) поверх модели по умолчанию.
      model: request.model ?? this.config.polzaAiModelFor(ctx.purpose) ?? '',
    };
    const started = Date.now();

    try {
      // Модель уходит явно: подстановка по умолчанию внутри PolzaClient не знает
      // purpose, и AiUsage.model разошлась бы с тем, чем реально ушёл запрос.
      const result = await this.polza.chatCompletion({
        ...request,
        model: base.model || undefined,
      });
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
   * Диалог с инструментами (TASK-147): модель просит данные, инструменты их
   * отдают, модель отвечает. Каждый раунд — обычный `complete`: та же фича,
   * лимит и строка AiUsage, второй двери к Polza нет.
   *
   * Набор инструментов собран на одного продавца, и он обязан совпасть с тем,
   * на кого пишется учёт: разъехались — ошибка программиста, а не продавца.
   * Закрытая фича или лимит отказывают на первом раунде — до HTTP и до любого
   * инструмента.
   */
  public async completeWithTools(
    ctx: IAiContext,
    request: IChatCompletionRequest,
    toolbox: IAiToolbox,
    now: Date = new Date(),
  ): Promise<IAiToolsCompletion> {
    if (!toolbox) throw new Error('AiService.completeWithTools: не передан набор инструментов');
    if (toolbox.telegramUserId !== ctx?.telegramUserId) {
      throw new Error('AiService.completeWithTools: инструменты собраны на другого продавца');
    }

    const messages: IPolzaMessage[] = [...request.messages];
    const toolResults: IAiToolInvocation[] = [];
    let costRub = 0;

    for (let round = 1; round <= MAX_TOOL_ROUNDS + 1; round++) {
      // Последний раунд — без инструментов: продавцу нужен ответ, а не ещё один вызов.
      const last = round > MAX_TOOL_ROUNDS;
      const result = await this.complete(
        ctx,
        {
          ...request,
          messages,
          tools: toolbox.definitions,
          toolChoice: last ? 'none' : (request.toolChoice ?? 'auto'),
        },
        now,
      );
      costRub += result.usage.costRub;
      if (last || !result.toolCalls.length) {
        return { ...result, toolResults, rounds: round, costRub };
      }

      messages.push({
        role: 'assistant',
        content: result.content || null,
        toolCalls: result.toolCalls,
      });
      // Вызовы раунда идут по очереди и делят один потолок времени.
      const deadline = Date.now() + AI_TOOL_ROUND_TIMEOUT_MS;
      for (const [index, call] of result.toolCalls.entries()) {
        const invocation = await invokeTool(toolbox, call, index, deadline - Date.now());
        toolResults.push(invocation);
        // На каждый вызов — ответ с его id: без пары следующий запрос Polza отклонит.
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(invocation.result),
        });
      }
    }
    // Недостижимо: последний раунд возвращает всегда.
    throw new Error('AiService.completeWithTools: цикл без ответа');
  }

  /**
   * Баланс Polza — системный запрос самопроверки, не продавца.
   *
   * Без фичи, лимита и строки AiUsage: запрос бесплатный и ничей. Ошибки НЕ
   * репортятся: о балансе судит HealthMonitorService, он пишет журнал с
   * alert: false и шлёт алерт по shouldNotify. Отчёт здесь дал бы вторую
   * запись и алерт мимо этого правила каждые пять минут.
   */
  public async balance(options: IPolzaCallOptions = {}): Promise<IPolzaBalance> {
    if (!this.config.polzaAiEnabled) throw new AiUnavailableError('POLZA_AI_TOKEN не задан');
    return await this.polza.getBalance(options);
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

async function invokeTool(
  toolbox: IAiToolbox,
  call: IPolzaToolCall,
  index: number,
  remainingMs: number,
): Promise<IAiToolInvocation> {
  let result: IAiToolResult;
  if (index >= MAX_TOOL_CALLS_PER_ROUND) {
    result = { ok: false, error: `Не больше ${MAX_TOOL_CALLS_PER_ROUND} вызовов за раз` };
  } else if (remainingMs <= 0) {
    // Потолок раунда уже съеден предыдущими вызовами — этот не запускается вовсе.
    result = { ok: false, error: TOOL_TIMEOUT_TEXT };
  } else {
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<IAiToolResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: TOOL_TIMEOUT_TEXT }), remainingMs);
    });
    try {
      result = await Promise.race([toolbox.call(call.name, call.arguments), guard]);
    } catch (error) {
      // Контракт — не бросать; если реализация всё же бросила, модель получает отказ, а не обрыв диалога.
      result = { ok: false, error: `Инструмент не ответил: ${(error as Error).message}` };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { name: call.name, arguments: call.arguments, result };
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
