import type { TFinanceMarketplace } from '../../../../database/postgres/finance.schema';
import type { TFinanceImportResult } from '../../../finance/finance-import.service';
import type { IFinancePeriod } from '../../../finance/finance-period';

import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { ErrorReporter } from '../../../errors/error-reporter.service';
import { financeToday, scheduledPeriods } from '../../../finance/finance-period';
import { MarketplaceNotConnectedError } from '../../../marketplaces/marketplace-adapter';
import { MarketplaceRegistry } from '../../../marketplaces/marketplace-registry.service';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';
import { FinanceImportScheduler } from '../services/finance-import.scheduler';

/**
 * Payload импорта: продавец и период — и всё. Токена нет намеренно: креды
 * сервис перечитывает из Mongo (свежие, и ничего секретного не лежит в Redis
 * среди упавших джоб) — довод stock-sync.
 *
 * Два вида под ОДНИМ именем джобы (второй `@Process` на очереди суммировал бы
 * concurrency, урок TASK-080): разовый период (`from`/`to`) и ночной проход по
 * расписанию (`scheduled`) — его периоды считаются в момент запуска, а не
 * постановки: повторяемая задача живёт месяцами.
 */
export type IFinanceImportJob =
  | {
      telegramUserId: string;
      /** ГГГГ-ММ-ДД. */
      from: string;
      /** ГГГГ-ММ-ДД, включительно. */
      to: string;
      /** Чей журнал; нет — ЯМ (задачи до TASK-131). */
      marketplace?: TFinanceMarketplace;
    }
  | { telegramUserId: string; scheduled: true };

/** Итог ночного прохода: по площадке и периоду — исход импорта или сбой. */
export interface IFinanceScheduledRun {
  skipped?: 'not-eligible';
  periods: {
    marketplace: TFinanceMarketplace;
    from: string;
    to: string;
    status: TFinanceImportResult['status'] | 'failed' | 'not-connected';
  }[];
}

/**
 * Единственный обработчик очереди finance-import, concurrency 1: Bull суммирует
 * concurrency всех `@Process` очереди (урок TASK-080), а две загрузки одного
 * периода разом упёрлись бы в уникальный индекс версии FinanceDocument.
 */
@Processor(QUEUE_NAMES.FINANCE_IMPORT)
export class FinanceImportProcessor {
  private readonly logger = new Logger(FinanceImportProcessor.name);

  constructor(
    private readonly marketplaces: MarketplaceRegistry,
    private readonly scheduler: FinanceImportScheduler,
    private readonly errors: ErrorReporter,
  ) {}

  @Process({ name: JOB_TYPES.IMPORT_FINANCE, concurrency: 1 })
  async handle(job: Job<IFinanceImportJob>): Promise<TFinanceImportResult | IFinanceScheduledRun> {
    const data = job.data;
    // `in`, а не проверка `scheduled`: без strictNullChecks union по
    // undefined-полю не сужается.
    if (!('from' in data)) return this.runScheduled(data.telegramUserId);

    const { telegramUserId, from, to } = data;
    const marketplace = data.marketplace ?? 'ym';
    this.logger.log(`Импорт журнала ${marketplace} ${telegramUserId} ${from}…${to}`);
    return this.importFinance(telegramUserId, marketplace, { from, to });
  }

  /**
   * Ночной проход: периоды по очереди, сбой одного не мешает следующим —
   * упавший месяц сообщается сам и повторится следующей ночью, а задача не
   * падает целиком (иначе один FAILED Маркета оставлял бы без загрузки и
   * текущий месяц).
   */
  private async runScheduled(telegramUserId: string): Promise<IFinanceScheduledRun> {
    // Право перепроверяется: задача могла остаться от прошлой сверки, а фичу
    // с тех пор закрыли или магазин отключили.
    const marketplaces = (await this.scheduler.marketplacesFor(telegramUserId)).filter(
      (marketplace) => this.marketplaces.withCapability('finance').includes(marketplace),
    );
    if (!marketplaces.length) {
      this.logger.log(`Загрузка финансов ${telegramUserId}: фича закрыта или нет магазина`);
      void this.scheduler.refresh();
      return { skipped: 'not-eligible', periods: [] };
    }

    const periods: IFinanceScheduledRun['periods'] = [];
    for (const marketplace of marketplaces) {
      for (const period of scheduledPeriods(financeToday())) {
        try {
          const result = await this.importFinance(telegramUserId, marketplace, period);
          periods.push({ marketplace, ...period, status: result.status });
        } catch (error) {
          // Ключ сняли между сверкой и запуском — не сбой: площадку пропускаем
          // целиком, остальные месяцы спросили бы о том же.
          if (error instanceof MarketplaceNotConnectedError) {
            periods.push({ marketplace, ...period, status: 'not-connected' });
            break;
          }
          void this.errors.report({
            error,
            source: 'queue',
            context: 'finance-import',
            telegramUserId,
            action: `${marketplace} ${period.from}…${period.to}`,
          });
          periods.push({ marketplace, ...period, status: 'failed' });
        }
      }
    }
    this.logger.log(
      `Загрузка финансов ${telegramUserId}: ` +
        periods.map((p) => `${p.marketplace} ${p.from.slice(0, 7)} ${p.status}`).join(', '),
    );
    return { periods };
  }

  /**
   * Через реестр площадок (TASK-127, TASK-162): ЯМ и Ozon (TASK-131) — один
   * процессор, площадка — аргумент. Площадка без возможности `finance` —
   * отказ реестра, не заглушка.
   */
  private importFinance(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    period: IFinancePeriod,
  ): Promise<TFinanceImportResult> {
    return this.marketplaces
      .require(marketplace, 'finance', telegramUserId)
      .importFinance({ telegramUserId, marketplace }, period);
  }

  /**
   * Свой хук законен: очередь своя (на `reports` его держит ReportsProcessor).
   * ReportGenerationError несёт reportId и времена Маркета — ErrorReporter
   * кладёт их в строку журнала. Ночной проход сюда не падает — периоды он
   * сообщает сам.
   */
  @OnQueueFailed()
  onFailed(job: Job<IFinanceImportJob>, error: Error): void {
    const data = job.data;
    void this.errors.report({
      error,
      source: 'queue',
      context: 'finance-import',
      telegramUserId: data?.telegramUserId,
      action:
        data && 'from' in data
          ? `${data.marketplace ?? 'ym'} ${data.from}…${data.to}`
          : 'по расписанию',
    });
  }
}
