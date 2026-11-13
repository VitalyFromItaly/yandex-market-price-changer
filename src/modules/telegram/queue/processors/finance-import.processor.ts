import type { TFinanceMarketplace } from '../../../../database/postgres/finance.schema';
import type { TFinanceImportResult } from '../../../finance/finance-import.service';
import type { IFinancePeriod } from '../../../finance/finance-period';
import type { TFinanceSyncTrigger } from '../../../finance/finance-sync';

import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { ErrorReporter } from '../../../errors/error-reporter.service';
import {
  FINANCE_REPORT_TYPE,
  financePeriodKey,
  financeToday,
  scheduledPeriods,
} from '../../../finance/finance-period';
import { mergePeriods, syncErrorText } from '../../../finance/finance-sync';
import { MarketplaceNotConnectedError } from '../../../marketplaces/marketplace-adapter';
import { MarketplaceRegistry } from '../../../marketplaces/marketplace-registry.service';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';
import { FinanceImportScheduler } from '../services/finance-import.scheduler';
import { ACCOUNTING_FREQUENT_MARKETPLACES } from '../services/finance-schedule';
import { FinanceSyncService } from '../services/finance-sync.service';

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
      /** Кто поставил (TASK-212): кнопка, повтор после сбоя; нет — кнопка (задачи до TASK-212). */
      trigger?: Extract<TFinanceSyncTrigger, 'manual' | 'retry'>;
      /** Номер попытки периода: 1 — первая, 2… — повторы. Нет — 1. */
      attempt?: number;
    }
  | {
      telegramUserId: string;
      scheduled: true;
      /** `frequent` — текущий месяц «Финучёта» (`finacc-`, TASK-212); нет — ночной проход. */
      mode?: 'frequent';
    };

/** Исход попытки периода. */
type TPeriodStatus = TFinanceImportResult['status'] | 'failed' | 'not-connected';

/** Итог прохода по расписанию: по площадке и периоду — исход импорта или сбой. */
export interface IFinanceScheduledRun {
  skipped?: 'not-eligible';
  periods: {
    marketplace: TFinanceMarketplace;
    from: string;
    to: string;
    status: TPeriodStatus;
    /** Как попал в проход; нет — по расписанию. */
    trigger?: TFinanceSyncTrigger;
  }[];
}

/** Как прошла попытка периода и что делать при сбое. */
interface IAttemptOptions {
  trigger: TFinanceSyncTrigger;
  attempt: number;
  /** Площадка «Финучёта»: сбой — повтор с backoff, после последнего — уведомление. */
  accounting: boolean;
  /** Разовая задача по кнопке: сбой уходит в Bull (`@OnQueueFailed`), а не глушится. */
  rethrow: boolean;
}

/**
 * Единственный обработчик очереди finance-import, concurrency 1: Bull суммирует
 * concurrency всех `@Process` очереди (урок TASK-080), а две загрузки одного
 * периода разом упёрлись бы в уникальный индекс версии FinanceDocument. Частая
 * задача «Финучёта» и повторы после сбоя (TASK-212) идут сюда же — по той же
 * причине.
 */
@Processor(QUEUE_NAMES.FINANCE_IMPORT)
export class FinanceImportProcessor {
  private readonly logger = new Logger(FinanceImportProcessor.name);

  constructor(
    private readonly marketplaces: MarketplaceRegistry,
    private readonly scheduler: FinanceImportScheduler,
    private readonly errors: ErrorReporter,
    private readonly sync: FinanceSyncService,
  ) {}

  @Process({ name: JOB_TYPES.IMPORT_FINANCE, concurrency: 1 })
  async handle(job: Job<IFinanceImportJob>): Promise<TFinanceImportResult | IFinanceScheduledRun> {
    const data = job.data;
    // `in`, а не проверка `scheduled`: без strictNullChecks union по
    // undefined-полю не сужается.
    if (!('from' in data)) return this.runScheduled(data.telegramUserId, data.mode ?? 'nightly');

    const { telegramUserId, from, to } = data;
    const marketplace = data.marketplace ?? 'ym';
    const trigger = data.trigger ?? 'manual';
    this.logger.log(`Импорт журнала ${marketplace} ${telegramUserId} ${from}…${to} (${trigger})`);
    const accounting = (await this.sync.accountingMarketplacesFor(telegramUserId)).includes(
      marketplace,
    );
    const { status, result } = await this.attempt(
      telegramUserId,
      marketplace,
      { from, to },
      {
        trigger,
        attempt: data.attempt ?? 1,
        accounting,
        // Кнопка — как до TASK-212: сбой виден в Bull и в ErrorReporter через хук.
        // Повтор после сбоя свой следующий шаг решает сам.
        rethrow: trigger === 'manual',
      },
    );
    return result ?? { periods: [{ marketplace, from, to, status, trigger }] };
  }

  /**
   * Проход по расписанию: периоды по очереди, сбой одного не мешает следующим —
   * упавший месяц сообщается сам и повторится (у «Финучёта» — отложенным
   * повтором, у остальных — следующей ночью), а задача не падает целиком
   * (иначе один FAILED Маркета оставлял бы без загрузки и текущий месяц).
   *
   * Ночью продавцу «Финучёта» грузится окно перезагрузки (`FIN_ACCOUNTING_RELOAD_MONTHS`)
   * поверх обычных месяцев; частая задача — только текущий месяц ЯМ и Ozon и
   * пропущенные периоды окна.
   */
  private async runScheduled(
    telegramUserId: string,
    mode: 'nightly' | 'frequent',
  ): Promise<IFinanceScheduledRun> {
    const capable = this.marketplaces.withCapability('finance');
    const accounting = new Set(
      (await this.sync.accountingMarketplacesFor(telegramUserId)).filter((mp) =>
        capable.includes(mp),
      ),
    );
    // Право перепроверяется: задача могла остаться от прошлой сверки, а фичу
    // с тех пор закрыли или магазин отключили.
    const marketplaces =
      mode === 'frequent'
        ? [...accounting].filter((mp) => ACCOUNTING_FREQUENT_MARKETPLACES.has(mp))
        : (await this.scheduler.marketplacesFor(telegramUserId)).filter((mp) =>
            capable.includes(mp),
          );
    if (!marketplaces.length) {
      this.logger.log(`Загрузка финансов ${telegramUserId}: фича закрыта или нет магазина`);
      void this.scheduler.refresh();
      return { skipped: 'not-eligible', periods: [] };
    }
    if (mode === 'nightly') await this.sync.prune();

    const today = financeToday();
    const periods: IFinanceScheduledRun['periods'] = [];
    for (const marketplace of marketplaces) {
      const isAccounting = accounting.has(marketplace);
      const planned = this.plannedPeriods(mode, isAccounting, today);
      const options = { trigger: mode, attempt: 1, accounting: isAccounting, rethrow: false };

      let connected = true;
      for (const period of planned) {
        const { status } = await this.attempt(telegramUserId, marketplace, period, options);
        periods.push({ marketplace, ...period, status });
        // Ключ сняли между сверкой и запуском — не сбой: площадку пропускаем
        // целиком, остальные месяцы спросили бы о том же.
        if (status === 'not-connected') {
          connected = false;
          break;
        }
      }

      // Пропущенные периоды окна (успеха не было) — в этот же проход: частая
      // задача их и ставит в очередь (TASK-212).
      if (mode === 'frequent' && connected) {
        const done = new Set(planned.map((period) => period.from));
        for (const row of await this.sync.missed(telegramUserId, marketplace)) {
          if (done.has(row.period.from)) continue;
          const { status } = await this.attempt(telegramUserId, marketplace, row.period, {
            ...options,
            trigger: 'missed',
          });
          periods.push({ marketplace, ...row.period, status, trigger: 'missed' });
          if (status === 'not-connected') break;
        }
      }
    }
    this.logger.log(
      `Загрузка финансов ${telegramUserId} (${mode}): ` +
        periods.map((p) => `${p.marketplace} ${p.from.slice(0, 7)} ${p.status}`).join(', '),
    );
    return { periods };
  }

  /** Месяцы прохода: частая — текущий; ночью «Финучёту» — окно поверх обычных месяцев. */
  private plannedPeriods(
    mode: 'nightly' | 'frequent',
    accounting: boolean,
    today: string,
  ): IFinancePeriod[] {
    if (mode === 'frequent') return scheduledPeriods(today).slice(0, 1);
    if (!accounting) return scheduledPeriods(today);
    return mergePeriods(scheduledPeriods(today), this.sync.reloadWindow());
  }

  /**
   * Одна попытка периода с записью в журнал синхронизации (TASK-212). Сбой у
   * площадки «Финучёта» — отложенный повтор, после последнего — уведомление;
   * успешный повтор снимает уведомление сразу.
   */
  private async attempt(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    period: IFinancePeriod,
    options: IAttemptOptions,
  ): Promise<{ status: TPeriodStatus; result?: TFinanceImportResult }> {
    const startedAt = new Date();
    const run = {
      telegramUserId,
      marketplace,
      periodKey: financePeriodKey(FINANCE_REPORT_TYPE[marketplace], period),
      periodFrom: period.from,
      periodTo: period.to,
      trigger: options.trigger,
      attempt: options.attempt,
      startedAt,
    };
    try {
      const result = await this.importFinance(telegramUserId, marketplace, period);
      await this.sync.record({ ...run, outcome: result.status, finishedAt: new Date() });
      if (options.accounting && options.attempt > 1) await this.sync.notify(telegramUserId);
      return { status: result.status, result };
    } catch (error) {
      if (error instanceof MarketplaceNotConnectedError) {
        await this.sync.record({ ...run, outcome: 'not-connected', finishedAt: new Date() });
        if (options.rethrow) throw error;
        return { status: 'not-connected' };
      }
      await this.sync.record({
        ...run,
        outcome: 'failed',
        error: syncErrorText(error),
        finishedAt: new Date(),
      });
      if (options.accounting) {
        await this.sync.afterFailure(telegramUserId, marketplace, period, options.attempt);
      }
      if (options.rethrow) throw error;
      void this.errors.report({
        error,
        source: 'queue',
        context: 'finance-import',
        telegramUserId,
        action: `${marketplace} ${period.from}…${period.to}`,
      });
      return { status: 'failed' };
    }
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
