import type { IStockPushJob } from '../../telegram/queue/processors/stock-sync.processor';

import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Queue } from 'bull';
import { randomUUID } from 'node:crypto';

import { CrmJobResultService } from '../../../database/services/crm-job-result.service';
import { stockPushWriteOpen } from '../../stock-push/stock-push.service';
import { JOB_TYPES, QUEUE_NAMES } from '../../telegram';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import {
  INVALID_PLAN,
  INVALID_PLAN_TEXT,
  PUSH_RUNNING,
  PUSH_RUNNING_TEXT,
  STOCK_PUSH_APPLY_KIND,
  WRITE_CLOSED,
  WRITE_CLOSED_TEXT,
  parsePlanHash,
} from './crm-stock-push.domain';

/**
 * Запись плана «Передачи остатков» на площадки (TASK-143, Ozon/WB — TASK-175).
 * Гвард класса — только `stock_push`: фича записи у каждой площадки своя, и
 * маршрут открыт, если открыта хоть одна; какие цели писать, решает `apply`
 * сервиса по снимку features. Ставит `SYNC_STOCKS` с
 * `source: 'push'` в ту же очередь file-processing, что прайс: запись остатков
 * — одна за раз на оба канала. Итог — `CrmJobResult`, веб опрашивает его
 * обычным `GET /crm/ym/jobs/:id`.
 */
@Controller('crm/ym/stock-push')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.STOCK_PUSH)
export class CrmStockPushController {
  constructor(
    @InjectQueue(QUEUE_NAMES.FILE_PROCESSING) private readonly queue: Queue,
    private readonly results: CrmJobResultService,
  ) {}

  @Post('apply')
  @HttpCode(HttpStatus.ACCEPTED)
  async apply(
    @Req() request: IRequestWithCrmUser,
    @Body() body: { planHash?: unknown },
  ): Promise<{ jobId: string }> {
    const user = request.crmUser;
    if (!stockPushWriteOpen(user.features ?? {})) {
      throw new ForbiddenException({
        statusCode: 403,
        code: WRITE_CLOSED,
        message: WRITE_CLOSED_TEXT,
      });
    }
    const planHash = parsePlanHash(body?.planHash);
    if (!planHash) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_PLAN,
        message: INVALID_PLAN_TEXT,
      });
    }

    const claim = await this.results.claim({
      jobId: randomUUID(),
      telegramUserId: user.telegramUserId,
      kind: STOCK_PUSH_APPLY_KIND,
      params: { planHash },
    });
    // Отказ, а не «вот идущая задача»: подтверждены ДРУГИЕ числа (довод прайса).
    if (!claim.created) {
      throw new ConflictException({
        statusCode: 409,
        code: PUSH_RUNNING,
        jobId: claim.jobId,
        message: PUSH_RUNNING_TEXT,
      });
    }

    const payload: IStockPushJob = {
      source: 'push',
      jobId: claim.jobId,
      telegramUserId: user.telegramUserId,
      planHash,
      features: { ...user.features },
    };
    try {
      // attempts: 1 — повтор записи вслепую = двойная запись и квота Partner API.
      await this.queue.add(JOB_TYPES.SYNC_STOCKS, payload, { attempts: 1, jobId: claim.jobId });
    } catch (error) {
      await this.results.finishFailed(claim.jobId, 'Очередь недоступна. Попробуйте позже.');
      throw error;
    }
    return { jobId: claim.jobId };
  }
}
