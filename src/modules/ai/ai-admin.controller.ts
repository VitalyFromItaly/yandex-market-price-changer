import type { IPolzaBalance } from './polza.client';
import type { TAiUsageStatus } from '../../database/schemas/ai-usage.schema';
import type { IAiUsageQuery } from '../../database/services/ai-usage.service';

import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AiUsageService, MAX_AI_PAGE_SIZE } from '../../database/services/ai-usage.service';
import { UserAccessService } from '../../database/services/user-access.service';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';

import {
  AI_USAGE_RANGES,
  errorShare,
  fillDays,
  isAiUsageRange,
  moscowDays,
} from './ai-usage.domain';
import { AiUnavailableError } from './ai.errors';
import { AiService } from './ai.service';
import { PolzaAuthError, PolzaInsufficientFundsError } from './polza.errors';

/**
 * Потолок ожидания баланса. Живой баланс отвечает за 0,3–1 с, но первый
 * запрос однажды шёл 68 с, а таймаут клиента — 620 с (он под ответ модели).
 * Без своей гонки страница висела бы минутами из-за одной цифры.
 */
export const AI_BALANCE_TIMEOUT_MS = 10_000;

const STATUSES: readonly TAiUsageStatus[] = ['ok', 'error'];

interface IWho {
  username?: string;
  name?: string;
}

/**
 * Расходы на ИИ для владельца: `GET /api/ai/usage`, `GET /api/ai/requests`.
 *
 * Гвард на весь контроллер (довод LogsController). Свой модуль, а не роут в
 * AiModule: тот импортируют монитор и хендлеры, и тянуть в их граф админскую
 * авторизацию незачем. Текста промпта и ответа нет ни здесь, ни в базе.
 */
@Controller('ai')
@UseGuards(AdminJwtGuard)
export class AiAdminController {
  constructor(
    private readonly usage: AiUsageService,
    private readonly access: UserAccessService,
    private readonly ai: AiService,
  ) {}

  @Get('usage')
  async report(@Query('range') range = '7d') {
    if (!isAiUsageRange(range)) {
      throw new BadRequestException('range: ожидается 24h, 7d или 30d');
    }
    const until = new Date();
    const since = new Date(until.getTime() - AI_USAGE_RANGES[range]);

    // Баланс параллельно и с поглощённым сбоем: страница о расходах открывается
    // и без Polza — нет ключа, ключ отозван или ответа нет.
    const [summary, balance] = await Promise.all([
      this.usage.summary(since, until),
      this.balance(),
    ]);
    const who = await this.whoOf(summary.byUser.map((row) => row.telegramUserId));

    return {
      range,
      since: since.getTime(),
      until: until.getTime(),
      ...balance,
      totals: summary.totals,
      errorShare: errorShare(summary.totals.errors, summary.totals.requests),
      days: fillDays(moscowDays(since, until), summary.byDay),
      users: summary.byUser.map((row) => ({ ...row, ...who(row.telegramUserId) })),
      purposes: summary.byPurpose,
    };
  }

  @Get('requests')
  async requests(
    @Query('telegramUserId') telegramUserId?: string,
    @Query('purpose') purpose?: string,
    @Query('status') status?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    if (status && !STATUSES.includes(status as TAiUsageStatus)) {
      throw new BadRequestException('status: ожидается ok или error');
    }
    const query: IAiUsageQuery = {
      telegramUserId,
      purpose,
      status: (status || undefined) as TAiUsageStatus | undefined,
      since: this.dateOf(since, 'since'),
      until: this.dateOf(until, 'until'),
      limit: this.numberOf(limit, 'limit'),
      skip: this.numberOf(skip, 'skip'),
    };

    const [items, total] = await Promise.all([this.usage.list(query), this.usage.count(query)]);
    const who = await this.whoOf(items.map((row) => row.telegramUserId));

    return {
      total,
      limit: Math.min(query.limit ?? 50, MAX_AI_PAGE_SIZE),
      skip: query.skip ?? 0,
      items: items.map((row) => ({
        createdAt: row.createdAt,
        telegramUserId: row.telegramUserId,
        ...who(row.telegramUserId),
        purpose: row.purpose,
        model: row.model,
        responseModel: row.responseModel,
        provider: row.provider,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        cachedTokens: row.cachedTokens,
        reasoningTokens: row.reasoningTokens,
        costRub: row.costRub,
        durationMs: row.durationMs,
        traceId: row.traceId,
        status: row.status,
        httpStatus: row.httpStatus,
        errorCode: row.errorCode,
      })),
    };
  }

  /**
   * Баланс или причина, почему его нет. Ошибка не репортится: о балансе судит
   * HealthMonitorService (правило AiService.balance()), второй отчёт отсюда
   * дал бы алерт мимо его shouldNotify при каждом открытии страницы.
   */
  private async balance(): Promise<{ balance: IPolzaBalance | null; balanceError: string | null }> {
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`нет ответа за ${AI_BALANCE_TIMEOUT_MS / 1000} с`)),
        AI_BALANCE_TIMEOUT_MS,
      );
    });
    try {
      return { balance: await Promise.race([this.ai.balance(), guard]), balanceError: null };
    } catch (error) {
      return { balance: null, balanceError: balanceErrorText(error) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Ники — ОДНИМ access.list() на ответ, не на строку. botId в AiUsage нет,
   * поэтому только карта по telegramUserId (запасная карта QueuesController):
   * один аккаунт Telegram у разных ботов носит один ник.
   */
  private async whoOf(ids: string[]): Promise<(telegramUserId: string) => IWho> {
    if (!ids.length) return () => ({});
    const users = await this.access.list();
    const byUser = new Map(users.map((user) => [user.telegramUserId, user]));
    return (telegramUserId) => {
      const user = byUser.get(telegramUserId);
      if (!user) return {};
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
      return { username: user.username || undefined, name: name || undefined };
    };
  }

  /** Мусор в дате — 400, а не полная выдача под видом ответа на фильтр. */
  private dateOf(value: string | undefined, field: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field}: ожидается дата ISO, например 2026-07-30`);
    }
    return date;
  }

  private numberOf(value: string | undefined, field: string): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`${field}: ожидается целое неотрицательное число`);
    }
    return parsed;
  }
}

export function balanceErrorText(error: unknown): string {
  if (error instanceof AiUnavailableError) return 'ИИ выключен: POLZA_AI_TOKEN не задан';
  if (error instanceof PolzaAuthError) return 'ключ отозван или неверен (HTTP 401)';
  if (error instanceof PolzaInsufficientFundsError) return 'нет средств на балансе (HTTP 402)';
  return `баланс не прочитан: ${(error as Error)?.message ?? String(error)}`;
}
