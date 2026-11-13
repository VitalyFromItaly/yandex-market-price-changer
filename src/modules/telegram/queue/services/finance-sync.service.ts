import type { TFinanceMarketplace } from '../../../../database/postgres/finance.schema';
import type { IFinanceSyncRunInput } from '../../../../database/postgres/repositories/finance-sync-run.repository';
import type { IFinancePeriod } from '../../../finance/finance-period';
import type { IFinanceSyncWindowRow } from '../../../finance/finance-sync';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../../../config/app-config.service';
import { FinanceSyncRunRepository } from '../../../../database/postgres/repositories/finance-sync-run.repository';
import { UserAccessService } from '../../../../database/services/user-access.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { financeToday } from '../../../finance/finance-period';
import {
  SYNC_RUNS_RETENTION_DAYS,
  missedToQueue,
  reloadWindow,
  syncRetryDelayMs,
  syncWindowRows,
} from '../../../finance/finance-sync';
import { NotificationsService } from '../../../notifications/notifications.service';

import { FinanceImportScheduler } from './finance-import.scheduler';
import { pickNotificationUsers } from './seller-notifications-schedule';

/**
 * Надёжность загрузки финансов «Финучёта» (TASK-212): журнал попыток,
 * отложенные повторы, пропущенные периоды и уведомление о сбое. Процессор
 * finance-import зовёт его вокруг каждой попытки периода; сам процессор
 * остаётся единственным `@Process` очереди.
 *
 * Ни один метод не бросает: журнал и уведомление — побочные, и их сбой не
 * должен валить загрузку данных (политика ErrorReporter).
 */
@Injectable()
export class FinanceSyncService {
  private readonly logger = new Logger(FinanceSyncService.name);

  constructor(
    private readonly scheduler: FinanceImportScheduler,
    private readonly runs: FinanceSyncRunRepository,
    private readonly config: AppConfigService,
    private readonly access: UserAccessService,
    private readonly notifications: NotificationsService,
    private readonly errors: ErrorReporter,
  ) {}

  /** Площадки «Финучёта» продавца; сбой Mongo — пусто (загрузка идёт по старым правилам). */
  async accountingMarketplacesFor(telegramUserId: string): Promise<TFinanceMarketplace[]> {
    try {
      return await this.scheduler.accountingMarketplacesFor(telegramUserId);
    } catch (error) {
      this.report(error, telegramUserId, 'право «Финучёта»');
      return [];
    }
  }

  /** Окно перезагрузки на сегодня. */
  reloadWindow(now: Date = new Date()): IFinancePeriod[] {
    return reloadWindow(financeToday(now), this.config.finAccountingReloadMonths);
  }

  /** Записать попытку в журнал синхронизации. */
  async record(run: IFinanceSyncRunInput): Promise<void> {
    try {
      await this.runs.record(run);
    } catch (error) {
      this.report(error, run.telegramUserId, 'журнал синхронизации');
    }
  }

  /**
   * После сбоя попытки номер `attempt`: повторы ещё есть — отложенная задача
   * через `syncRetryDelayMs`; это был последний — уведомление продавцу.
   */
  async afterFailure(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    period: IFinancePeriod,
    attempt: number,
  ): Promise<'retry' | 'notified'> {
    if (attempt <= this.config.finAccountingRetryAttempts) {
      try {
        await this.scheduler.scheduleRetry(
          telegramUserId,
          marketplace,
          period,
          attempt + 1,
          syncRetryDelayMs(attempt),
        );
        return 'retry';
      } catch (error) {
        // Повтор не поставился (Redis) — продавцу честнее сказать сразу.
        this.report(error, telegramUserId, 'повтор загрузки');
      }
    }
    await this.notify(telegramUserId);
    return 'notified';
  }

  /**
   * Пересчитать правило «Сбой загрузки финансов» сразу, не дожидаясь дневной
   * проверки: поднять после последнего сбоя, снять после успешного повтора.
   * Только продавцам с открытыми уведомлениями (`pickNotificationUsers`):
   * админам авторассылки нет (`notifications_admins_not_auto`).
   */
  async notify(telegramUserId: string): Promise<void> {
    try {
      const rows = await this.access.findByLogin(telegramUserId);
      const features = pickNotificationUsers(rows).get(telegramUserId);
      if (!features) return;
      const result = await this.notifications.checkFinanceSync(telegramUserId, features);
      if (result.created.length || result.resolved) {
        this.logger.log(
          `Сбой загрузки финансов ${telegramUserId}: уведомлений ${result.created.length}, снято ${result.resolved}`,
        );
      }
    } catch (error) {
      this.report(error, telegramUserId, 'уведомление о сбое загрузки');
    }
  }

  /**
   * Пропущенные периоды окна площадки, которые пора загрузить: успеха не было,
   * последняя попытка старше интервала частой загрузки.
   */
  async missed(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    now: Date = new Date(),
  ): Promise<IFinanceSyncWindowRow[]> {
    try {
      const states = await this.runs.states(telegramUserId, [marketplace]);
      const rows = syncWindowRows([marketplace], this.reloadWindow(now), states);
      const cooldownMs = this.config.finAccountingSyncEveryHours * 3_600_000;
      return missedToQueue(rows, now, cooldownMs);
    } catch (error) {
      this.report(error, telegramUserId, 'пропущенные периоды');
      return [];
    }
  }

  /** Срок хранения журнала: старше `SYNC_RUNS_RETENTION_DAYS` — удалить. */
  async prune(now: Date = new Date()): Promise<void> {
    try {
      await this.runs.prune(new Date(now.getTime() - SYNC_RUNS_RETENTION_DAYS * 86_400_000));
    } catch (error) {
      this.report(error, undefined, 'чистка журнала синхронизации');
    }
  }

  private report(error: unknown, telegramUserId: string | undefined, action: string): void {
    void this.errors.report({
      error,
      source: 'queue',
      context: 'finance-import:sync',
      telegramUserId,
      action,
    });
  }
}
