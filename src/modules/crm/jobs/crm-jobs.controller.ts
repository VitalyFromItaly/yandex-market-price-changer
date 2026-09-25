import type { ICrmJobPayload } from './crm-jobs.domain';
import type { TCrmJobStatus } from '../../../database/schemas/crm-job-result.schema';

import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Queue } from 'bull';
import { randomUUID } from 'node:crypto';

import { CrmJobResultService } from '../../../database/services/crm-job-result.service';
import { JOB_TYPES, QUEUE_NAMES } from '../../telegram';
import { StoresService } from '../../yandex/stores/stores.service';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { STORE_NOT_FOUND, STORE_NOT_FOUND_TEXT } from '../stores/crm-stores.domain';

import { CrmJobsRegistry } from './crm-jobs.registry';

interface IStartJobDto {
  kind?: unknown;
  params?: unknown;
  /** Ключ магазина из URL (`storeKeyOf`) — отчёт считается по нему. */
  store?: unknown;
}

export interface ICrmJobView {
  jobId: string;
  kind: string;
  status: TCrmJobStatus;
  data: unknown;
  error: string | null;
  file: { filename: string } | null;
}

const NOT_FOUND = 'Задача не найдена или уже удалена';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Фоновые задачи CRM: /api/crm/ym/jobs. Долгий отчёт ставится в очередь
 * `crm-jobs`, веб опрашивает статус и забирает файл. Результат виден только
 * своему продавцу: чужой jobId отвечает тем же 404, что и несуществующий, —
 * иначе по ответу можно было бы перебирать чужие задачи.
 */
@Controller('crm/ym/jobs')
@UseGuards(CrmJwtGuard)
export class CrmJobsController {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly results: CrmJobResultService,
    private readonly guard: CrmJwtGuard,
    private readonly stores: StoresService,
    @InjectQueue(QUEUE_NAMES.CRM_JOBS) private readonly queue: Queue,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async start(
    @Req() request: IRequestWithCrmUser,
    @Body() body: IStartJobDto,
  ): Promise<{ jobId: string; created: boolean }> {
    const user = request.crmUser;
    const kind = typeof body?.kind === 'string' ? body.kind : '';
    const params = body?.params === undefined ? {} : body.params;
    const definition = this.registry.get(kind);

    if (!definition) throw new BadRequestException(`Неизвестный тип задачи: ${kind || '—'}`);
    if (!isPlainObject(params)) throw new BadRequestException('params должен быть объектом');

    // Все отчёты CRM — отчёты магазина, открытого в вебе; активный магазин
    // бота веб не читает и не пишет.
    const storeKey = typeof body?.store === 'string' ? body.store : '';
    if (!storeKey) throw new BadRequestException('Не выбран магазин');
    const resolved = await this.stores.resolve(user.telegramUserId, storeKey, {
      telegramUserId: user.telegramUserId,
      source: 'crm',
      context: `crm-job:${kind}`,
    });
    if (!resolved) {
      throw new NotFoundException({
        statusCode: 404,
        code: STORE_NOT_FOUND,
        message: STORE_NOT_FOUND_TEXT,
      });
    }
    const { campaignId } = resolved.entry;

    await this.guard.assertFeatures(user, definition.features, resolved.entry);

    const claim = await this.results.claim({
      jobId: randomUUID(),
      telegramUserId: user.telegramUserId,
      kind,
      params,
      scope: campaignId,
    });
    if (claim.created) {
      const payload: ICrmJobPayload = {
        jobId: claim.jobId,
        telegramUserId: user.telegramUserId,
        kind,
        params,
        features: user.features,
        campaignId,
      };
      try {
        await this.queue.add(JOB_TYPES.RUN_CRM_JOB, payload, { jobId: claim.jobId });
      } catch (error) {
        // Redis недоступен: без этого замок висел бы до TTL, и каждый
        // следующий POST возвращал бы задачу, которой нет в очереди.
        await this.results.finishFailed(claim.jobId, 'Очередь недоступна. Попробуйте позже.');
        throw error;
      }
    }
    return claim;
  }

  @Get(':id')
  async status(@Req() request: IRequestWithCrmUser, @Param('id') id: string): Promise<ICrmJobView> {
    const job = await this.results.findOwn(id, request.crmUser.telegramUserId);
    if (!job) throw new NotFoundException(NOT_FOUND);
    return {
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      data: job.data ?? null,
      error: job.error ?? null,
      file: job.file ? { filename: job.file.filename } : null,
    };
  }

  @Get(':id/file')
  async file(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const job = await this.results.findOwn(id, request.crmUser.telegramUserId);
    if (!job || job.status !== 'done' || !job.file) throw new NotFoundException(NOT_FOUND);

    const { filename, contentType } = job.file;
    // Из Mongo приходит BSON Binary, а не Buffer, — приводим явно.
    const buffer = Buffer.from(job.file.buffer as unknown as Uint8Array);
    return new StreamableFile(buffer, {
      type: contentType,
      length: buffer.length,
      disposition: contentDisposition(filename),
    });
  }
}

/** RFC 6266/5987: ASCII-запасное имя и полное UTF-8 — кириллица в имени файла. */
export function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
