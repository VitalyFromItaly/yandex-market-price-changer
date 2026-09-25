import type { ICrmFeedbackView } from './crm-feedback.domain';
import type {
  IStoreEntry,
  YandexMarketDocument,
} from '../../../database/schemas/yandex-market.schema';

import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ErrorReporter } from '../../errors/error-reporter.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { FEEDBACK_LOAD_ERROR_PLAIN } from '../../yandex/feedback/feedback-message';
import { FeedbackService } from '../../yandex/feedback/feedback.service';
import { StoresService } from '../../yandex/stores/stores.service';
import { YandexApiError } from '../../yandex/yandex-api.errors';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { MARKET_ERROR } from '../quarantine/crm-quarantine.domain';
import { STORE_NOT_FOUND, STORE_NOT_FOUND_TEXT } from '../stores/crm-stores.domain';

import {
  FEEDBACK_GONE,
  FEEDBACK_GONE_TEXT,
  INVALID_FEEDBACK,
  INVALID_FEEDBACK_TEXT,
  INVALID_REPLY,
  parseFeedbackId,
  parseReplyText,
  toCrmFeedbackView,
} from './crm-feedback.domain';

type TFeedbackAction = 'list' | 'reply' | 'skip';

const ACTION_TITLE: Record<TFeedbackAction, string> = {
  list: 'отзывы',
  reply: 'ответ на отзыв',
  skip: 'пропуск отзыва',
};

/**
 * «Отзывы» CRM: /api/crm/ym/feedback.
 *
 * Чтение и запись — `FeedbackService`, общий с ботом. Магазин — из ключа в
 * адресе (GET — query, POST — тело). Отзывы бизнесовые: магазин нужен только
 * затем, чтобы знать кабинет и его токен.
 *
 * Черновика на сервере нет: веб держит текст в форме и шлёт его один раз, из
 * превью. `UserAccess.pendingFeedbackReply/feedbackDraft` — бот, веб их не трогает.
 */
@Controller('crm/ym/feedback')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.GOODS_FEEDBACK)
export class CrmFeedbackController {
  constructor(
    private readonly stores: StoresService,
    private readonly feedback: FeedbackService,
    private readonly errors: ErrorReporter,
  ) {}

  @Get()
  async list(
    @Req() request: IRequestWithCrmUser,
    @Query('store') storeKey: unknown,
  ): Promise<ICrmFeedbackView> {
    const telegramUserId = request.crmUser.telegramUserId;
    const { store, entry } = await this.resolveStore(telegramUserId, storeKey, 'list');

    try {
      const page = await this.feedback.listNeedingReaction(store);
      return toCrmFeedbackView(entry.businessName ?? '', page);
    } catch (error) {
      throw this.marketFailure(error, telegramUserId, 'list', FEEDBACK_LOAD_ERROR_PLAIN);
    }
  }

  /**
   * Публикация ответа — ПУБЛИЧНАЯ запись на Маркете. Текст проверяется до
   * магазина и до Маркета; отзыв — по живому списку, иначе вторая вкладка
   * опубликовала бы второй комментарий.
   */
  @Post('reply')
  @HttpCode(HttpStatus.OK)
  async reply(
    @Req() request: IRequestWithCrmUser,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    const telegramUserId = request.crmUser.telegramUserId;
    const feedbackId = this.feedbackIdOf(body);
    const parsed = parseReplyText(body?.text);
    if ('error' in parsed) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_REPLY,
        field: 'text',
        message: parsed.error,
      });
    }
    const { store } = await this.resolveStore(telegramUserId, body?.store, 'reply');

    try {
      await this.assertAwaitingReaction(store, feedbackId);
      await this.feedback.reply(store, feedbackId, parsed.text);
      return { ok: true };
    } catch (error) {
      throw this.marketFailure(error, telegramUserId, 'reply');
    }
  }

  /** «Пропустить» — пометить прочитанным без ответа. Тоже запись в Маркет. */
  @Post('skip')
  @HttpCode(HttpStatus.OK)
  async skip(
    @Req() request: IRequestWithCrmUser,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    const telegramUserId = request.crmUser.telegramUserId;
    const feedbackId = this.feedbackIdOf(body);
    const { store } = await this.resolveStore(telegramUserId, body?.store, 'skip');

    try {
      await this.assertAwaitingReaction(store, feedbackId);
      await this.feedback.skip(store, [feedbackId]);
      return { ok: true };
    } catch (error) {
      throw this.marketFailure(error, telegramUserId, 'skip');
    }
  }

  private feedbackIdOf(body: Record<string, unknown>): number {
    const feedbackId = parseFeedbackId(body?.feedbackId);
    if (feedbackId === null) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_FEEDBACK,
        message: INVALID_FEEDBACK_TEXT,
      });
    }
    return feedbackId;
  }

  /**
   * Отзыв ещё ждёт реакции? Проверка по той же странице, что видел веб: иного
   * источника у экрана нет, а отзыв за её пределами он показать не мог.
   */
  private async assertAwaitingReaction(
    store: YandexMarketDocument,
    feedbackId: number,
  ): Promise<void> {
    const page = await this.feedback.listNeedingReaction(store);
    if (!page.items.some((item) => item.feedbackId === feedbackId)) {
      throw new ConflictException({
        statusCode: 409,
        code: FEEDBACK_GONE,
        message: FEEDBACK_GONE_TEXT,
      });
    }
  }

  private async resolveStore(
    telegramUserId: string,
    storeKey: unknown,
    action: TFeedbackAction,
  ): Promise<{ store: YandexMarketDocument; entry: IStoreEntry }> {
    if (typeof storeKey !== 'string' || !storeKey) {
      throw new BadRequestException('Не выбран магазин');
    }
    const resolved = await this.stores.resolve(telegramUserId, storeKey, {
      telegramUserId,
      source: 'crm',
      context: `crm-feedback:${action}`,
    });
    if (!resolved) {
      throw new NotFoundException({
        statusCode: 404,
        code: STORE_NOT_FOUND,
        message: STORE_NOT_FOUND_TEXT,
      });
    }
    return resolved;
  }

  /**
   * Ошибка Маркета — 502 с его `userMessage`. Остальное (включая 409 выше) —
   * наверх, в общий фильтр.
   */
  private marketFailure(
    error: unknown,
    telegramUserId: string,
    action: TFeedbackAction,
    fallback?: string,
  ): unknown {
    if (!(error instanceof YandexApiError)) return error;
    void this.errors.report({
      error,
      source: 'crm',
      context: `crm-feedback:${action}`,
      telegramUserId,
      action: ACTION_TITLE[action],
    });
    return new BadGatewayException({
      statusCode: 502,
      code: MARKET_ERROR,
      message: error.userMessage || fallback,
    });
  }
}
