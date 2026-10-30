import type { IPriceSetJob } from '../../telegram/queue/processors/stock-sync.processor';
import type { ICrmJobPayload } from '../jobs/crm-jobs.domain';
import type { IUploadedFile } from '../price-list/crm-price-list.domain';

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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Queue } from 'bull';
import { randomUUID } from 'node:crypto';

import { CrmJobResultService } from '../../../database/services/crm-job-result.service';
import { priceSetRequestOf } from '../../price-set/price-set.domain';
import { priceSetWriteOpen } from '../../price-set/price-set.service';
import { JOB_TYPES, QUEUE_NAMES } from '../../telegram';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { UPLOAD_LIMITS } from '../../yandex/stocks/stock-upload-policy';
import { uploadFileErrorText } from '../../yandex/stocks/stock-upload.texts';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { createUploadInterceptor } from '../crm-upload.interceptor';
import { INVALID_FILE, decodeFileName } from '../price-list/crm-price-list.domain';

import {
  FILE_EXTENSION_TEXT,
  INVALID_EXCLUDED,
  INVALID_EXCLUDED_TEXT,
  INVALID_MARKETPLACES,
  INVALID_MARKETPLACES_TEXT,
  INVALID_PLAN,
  INVALID_PLAN_TEXT,
  NO_FILE_TEXT,
  PLAN_RUNNING,
  PLAN_RUNNING_TEXT,
  PRICE_SET_APPLY_KIND,
  PRICE_SET_KIND,
  PRICE_SET_RUNNING,
  PRICE_SET_RUNNING_TEXT,
  WRITE_CLOSED,
  WRITE_CLOSED_TEXT,
  parseExcluded,
  parseMarketplaces,
  parsePlanHash,
  parsePlanJobId,
  priceFileExtensionOk,
} from './crm-price-set.domain';

/** Файл цен: лимит и текст 413 — те же, что у прайса. */
const PriceSetUploadInterceptor = createUploadInterceptor({
  maxBytes: UPLOAD_LIMITS.maxBytes,
  tooLargeMessage: uploadFileErrorText('size', ''),
});

/**
 * «Установка цен» CRM (TASK-202) — только доставка.
 *
 * `upload` кладёт файл во вход задачи плана (`CrmJobResult.input`, не Redis) и
 * ставит её в `crm-jobs` тем же kind-ом, что и наценка из `POST crm/jobs`:
 * считает план `CrmPriceSetKinds`, веб опрашивает `GET crm/jobs/:id`.
 *
 * `apply` пишет план: запрос плана берётся из сохранённого результата по
 * `planJobId` (файл после разбора не хранится), задача `SYNC_STOCKS` с
 * `source: 'price-set'` — в ту же очередь file-processing, что прайс и
 * «Передача остатков»: один `@Process`, запись — одна за раз.
 */
@Controller('crm/ym/price-set')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.PRICE_SET)
export class CrmPriceSetController {
  constructor(
    @InjectQueue(QUEUE_NAMES.FILE_PROCESSING) private readonly writeQueue: Queue,
    @InjectQueue(QUEUE_NAMES.CRM_JOBS) private readonly planQueue: Queue,
    private readonly results: CrmJobResultService,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(PriceSetUploadInterceptor)
  async upload(
    @Req() request: IRequestWithCrmUser,
    @UploadedFile() file: IUploadedFile | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<{ jobId: string; created: boolean }> {
    const user = request.crmUser;
    if (!file) throw invalidFile(NO_FILE_TEXT);
    const fileName = decodeFileName(file.originalname);
    if (!priceFileExtensionOk(fileName)) throw invalidFile(FILE_EXTENSION_TEXT);
    if (file.size > UPLOAD_LIMITS.maxBytes)
      throw invalidFile(uploadFileErrorText('size', fileName));
    const marketplaces = parseMarketplaces(body?.marketplaces);
    if (!marketplaces) throw invalidMarketplaces();

    const params = { source: 'file', fileName, marketplaces };
    const claim = await this.results.claim({
      jobId: randomUUID(),
      telegramUserId: user.telegramUserId,
      kind: PRICE_SET_KIND,
      params,
      input: { buffer: file.buffer, filename: fileName },
    });
    // Идущий план — другой запрос (другой файл или наценка): вернуть его вместо этого — обман.
    if (!claim.created) {
      throw new ConflictException({
        statusCode: 409,
        code: PLAN_RUNNING,
        jobId: claim.jobId,
        message: PLAN_RUNNING_TEXT,
      });
    }
    const payload: ICrmJobPayload = {
      jobId: claim.jobId,
      telegramUserId: user.telegramUserId,
      kind: PRICE_SET_KIND,
      params,
      features: user.features,
    };
    try {
      await this.planQueue.add(JOB_TYPES.RUN_CRM_JOB, payload, { jobId: claim.jobId });
    } catch (error) {
      await this.results.finishFailed(claim.jobId, 'Очередь недоступна. Попробуйте позже.');
      throw error;
    }
    return claim;
  }

  @Post('apply')
  @HttpCode(HttpStatus.ACCEPTED)
  async apply(
    @Req() request: IRequestWithCrmUser,
    @Body()
    body: { planJobId?: unknown; planHash?: unknown; marketplaces?: unknown; excluded?: unknown },
  ): Promise<{ jobId: string }> {
    const user = request.crmUser;
    if (!priceSetWriteOpen(user.features ?? {})) {
      throw new ForbiddenException({
        statusCode: 403,
        code: WRITE_CLOSED,
        message: WRITE_CLOSED_TEXT,
      });
    }
    const planHash = parsePlanHash(body?.planHash);
    const planJobId = parsePlanJobId(body?.planJobId);
    if (!planHash || !planJobId) throw invalidPlan();
    const marketplaces = parseMarketplaces(body?.marketplaces);
    if (marketplaces === null) throw invalidMarketplaces();
    const excluded = parseExcluded(body?.excluded);
    if (!excluded) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_EXCLUDED,
        message: INVALID_EXCLUDED_TEXT,
      });
    }
    // План — свой, посчитанный и ещё не истёкший: по его запросу apply пересчитает план.
    const plan = await this.results.findOwn(planJobId, user.telegramUserId);
    if (
      !plan ||
      plan.kind !== PRICE_SET_KIND ||
      plan.status !== 'done' ||
      !priceSetRequestOf((plan.data as { request?: unknown } | null)?.request)
    ) {
      throw invalidPlan();
    }

    const claim = await this.results.claim({
      jobId: randomUUID(),
      telegramUserId: user.telegramUserId,
      kind: PRICE_SET_APPLY_KIND,
      params: { planJobId, planHash, ...(marketplaces ? { marketplaces } : {}) },
    });
    // Отказ, а не «вот идущая задача»: подтверждены ДРУГИЕ числа (довод прайса).
    if (!claim.created) {
      throw new ConflictException({
        statusCode: 409,
        code: PRICE_SET_RUNNING,
        jobId: claim.jobId,
        message: PRICE_SET_RUNNING_TEXT,
      });
    }

    const payload: IPriceSetJob = {
      source: 'price-set',
      jobId: claim.jobId,
      telegramUserId: user.telegramUserId,
      planJobId,
      planHash,
      features: { ...user.features },
      excluded,
      ...(marketplaces ? { marketplaces } : {}),
    };
    try {
      // attempts: 1 — повтор записи вслепую = двойная запись в кабинет продавца.
      await this.writeQueue.add(JOB_TYPES.SYNC_STOCKS, payload, {
        attempts: 1,
        jobId: claim.jobId,
      });
    } catch (error) {
      await this.results.finishFailed(claim.jobId, 'Очередь недоступна. Попробуйте позже.');
      throw error;
    }
    return { jobId: claim.jobId };
  }
}

function invalidFile(message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code: INVALID_FILE, field: 'file', message });
}

function invalidPlan(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: INVALID_PLAN,
    message: INVALID_PLAN_TEXT,
  });
}

function invalidMarketplaces(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: INVALID_MARKETPLACES,
    message: INVALID_MARKETPLACES_TEXT,
  });
}
