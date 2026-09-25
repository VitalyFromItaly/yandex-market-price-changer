import type { ICrmJobPayload } from './crm-jobs.domain';
import type { Job } from 'bull';

import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';

import { CrmJobResultService } from '../../../database/services/crm-job-result.service';
import { YandexMarketService } from '../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../errors/error-reporter.service';
import { JOB_TYPES, QUEUE_NAMES } from '../../telegram';
import { reportErrorMessage } from '../../yandex/reports/report-message';
import { scopeStore } from '../../yandex/stores/stores.domain';

import {
  CRM_JOBS_CONCURRENCY,
  CrmJobError,
  MAX_RESULT_BYTES,
  STORE_GONE_TEXT,
  resultBytes,
  tooLargeText,
} from './crm-jobs.domain';
import { CrmJobsRegistry } from './crm-jobs.registry';

const NO_STORE_TEXT = 'Магазин не подключён — подключите его в боте.';
const LOST_TEXT = 'Задача прервалась. Попробуйте ещё раз.';

/**
 * Исполнитель фоновых задач CRM. Процессоры бота не тронуты: этот зовёт те же
 * сервисы через реестр kind-ов и кладёт итог в CrmJobResult вместо Telegram.
 *
 * Ошибка kind-а ловится здесь и становится статусом `failed` с человеческим
 * текстом — веб опрашивает документ, а не Bull.
 */
@Processor(QUEUE_NAMES.CRM_JOBS)
export class CrmJobsProcessor {
  private readonly logger = new Logger(CrmJobsProcessor.name);

  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly results: CrmJobResultService,
    private readonly yandexMarket: YandexMarketService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process({ name: JOB_TYPES.RUN_CRM_JOB, concurrency: CRM_JOBS_CONCURRENCY })
  async run(job: Job<ICrmJobPayload>): Promise<void> {
    const { jobId, telegramUserId, kind, params, features, campaignId } = job.data;
    try {
      const definition = this.registry.get(kind);
      if (!definition) throw new Error(`Неизвестный kind фоновой задачи CRM: ${kind}`);

      await this.results.markActive(jobId);
      const doc = await this.yandexMarket.findByTelegramUser(telegramUserId);
      if (!doc) throw new CrmJobError(NO_STORE_TEXT);
      // Магазин, открытый в вебе; задачи до появления поля — по активному.
      const store = campaignId ? scopeStore(doc, campaignId) : doc;
      if (!store) throw new CrmJobError(STORE_GONE_TEXT);

      const output = await definition.run({
        telegramUserId,
        store,
        params,
        features: features ?? {},
      });
      const bytes = resultBytes(output);
      if (bytes > MAX_RESULT_BYTES) {
        this.logger.warn(`crm-job ${kind} #${jobId}: результат ${bytes} байт — не сохраняю`);
        await this.results.finishFailed(jobId, tooLargeText(bytes));
        return;
      }
      await this.results.finishDone(jobId, output.data ?? null, output.file ?? null);
    } catch (error) {
      await this.fail(job.data, error);
    }
  }

  /**
   * Страховка на случай, когда `run` не дошёл до своего catch: воркер умер и
   * Bull провалил задачу по stalled. Без неё замок `activeKey` держался бы до
   * TTL, и продавец сутки видел бы «уже собирается». Очередь своя — второго
   * хука на `reports` здесь нет.
   */
  @OnQueueFailed()
  async onFailed(job: Job<ICrmJobPayload> | undefined, error: Error): Promise<void> {
    if (!job?.data?.jobId) return;
    const current = await this.results.find(job.data.jobId);
    if (current && (current.status === 'done' || current.status === 'failed')) return;
    await this.fail(job.data, error, LOST_TEXT);
  }

  private async fail(payload: ICrmJobPayload, error: unknown, text?: string): Promise<void> {
    const message =
      text ?? (error instanceof CrmJobError ? error.message : reportErrorMessage(error));
    try {
      await this.results.finishFailed(payload.jobId, message);
    } catch (writeError) {
      this.logger.error(`crm-job #${payload.jobId}: не удалось записать failed`, writeError);
    }
    // Ожидаемый отказ (нет магазина, нет данных) — не сбой, админов не будим.
    if (error instanceof CrmJobError) return;
    void this.errors.report({
      error,
      source: 'crm',
      context: `crm-job:${payload.kind}`,
      telegramUserId: payload.telegramUserId,
      action: `фоновая задача CRM «${payload.kind}» #${payload.jobId}`,
    });
  }
}
