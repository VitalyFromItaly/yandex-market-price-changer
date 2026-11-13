import type { TFinanceMarketplace } from '../../../../database/postgres/finance.schema';

import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bull';

import { AppConfigService } from '../../../../config/app-config.service';
import { MarketplaceConnectionService } from '../../../../database/services/marketplace-connection.service';
import { UserAccessService } from '../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { MOSCOW_TIME_ZONE } from '../../../yandex/reports/moscow-day';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

import {
  accountingOrdersCron,
  accountingOrdersJobId,
  parseAccountingOrdersJobId,
  pickAccountingOrdersUsers,
} from './accounting-orders-schedule';

/** Payload опроса: только продавец — токен процессор перечитывает из Mongo. */
export interface IAccountingOrdersJob {
  telegramUserId: string;
  scheduled: true;
}

export interface IAccountingOrdersScheduledJob {
  telegramUserId: string;
  cron: string;
  tz: string;
  next: number;
}

/**
 * Расписание снимка строк заказов «Финучёта» (TASK-210): по одной повторяемой
 * задаче `accorders-<id>` на продавца с `fin_accounting` и хотя бы одной
 * настроенной площадкой (ЯМ, Ozon, WB — TASK-211), раз в `FIN_ACCOUNTING_ORDERS_EVERY_MINUTES` минут. Админов нет. Сверяется
 * при старте и после правки доступа в панели (`refresh`); процессор всё равно
 * перепроверяет право в момент прохода.
 */
@Injectable()
export class AccountingOrdersScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccountingOrdersScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ACCOUNTING_ORDERS) private readonly queue: Queue,
    private readonly access: UserAccessService,
    private readonly stores: YandexMarketService,
    private readonly config: AppConfigService,
    private readonly errors: ErrorReporter,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const { added, removed } = await this.reconcile();
      this.logger.log(`Снимок строк заказов «Финучёта»: +${added} −${removed}`);
    } catch (error) {
      // Подняться приложению это не мешает (политика остальных планировщиков).
      this.logger.error('Не удалось сверить расписание снимка строк заказов', error as Error);
    }
  }

  /** Кому положен опрос — по всем строкам доступа. */
  async wanted(): Promise<string[]> {
    return [...(await this.pick(await this.access.list())).keys()];
  }

  /** Площадки, по которым опрос положен продавцу прямо сейчас (пусто — не положен). */
  async eligibleMarketplaces(telegramUserId: string): Promise<TFinanceMarketplace[]> {
    return (
      (await this.pick(await this.access.findByLogin(telegramUserId))).get(telegramUserId) ?? []
    );
  }

  /** Положен ли опрос одному продавцу прямо сейчас. */
  async isEligible(telegramUserId: string): Promise<boolean> {
    return (await this.eligibleMarketplaces(telegramUserId)).length > 0;
  }

  private async pick(
    accounts: Awaited<ReturnType<UserAccessService['list']>>,
  ): Promise<Map<string, TFinanceMarketplace[]>> {
    const ids = [...new Set(accounts.map((account) => account.telegramUserId))];
    if (!ids.length) return new Map();
    // То же правило «настроена», что у частой загрузки (finance-import.scheduler).
    const [stores, ozon, wb] = await Promise.all([
      this.stores.findByTelegramUsers(ids),
      this.connections.connectedUsers('ozon', ids),
      this.connections.connectedUsers('wb', ids),
    ]);
    const ym = new Set(
      stores
        .filter((store) => store.campaign_id && store.business_id && store.token)
        .map((store) => store.telegramUserId),
    );
    return pickAccountingOrdersUsers(accounts, { ym, ozon, wb });
  }

  /** Свести задачи `accorders-*` к `wanted()`: совпали id и cron — оставить, иначе снять. */
  async reconcile(): Promise<{ added: number; removed: number }> {
    const every = this.config.finAccountingOrdersEveryMinutes;
    const wanted = new Map<string, string>();
    for (const id of await this.wanted()) {
      wanted.set(accountingOrdersJobId(id), accountingOrdersCron(id, every));
    }
    let removed = 0;

    for (const job of await this.queue.getRepeatableJobs()) {
      if (!parseAccountingOrdersJobId(job.id)) continue;
      if (job.id && wanted.get(job.id) === job.cron) {
        wanted.delete(job.id);
        continue;
      }
      await this.queue.removeRepeatableByKey(job.key);
      removed += 1;
    }

    for (const [jobId, cron] of wanted) {
      const payload: IAccountingOrdersJob = {
        telegramUserId: parseAccountingOrdersJobId(jobId) ?? '',
        scheduled: true,
      };
      await this.queue.add(JOB_TYPES.SYNC_ACCOUNTING_ORDERS, payload, {
        jobId,
        repeat: { cron, tz: MOSCOW_TIME_ZONE },
        removeOnComplete: 20,
        removeOnFail: 50,
        attempts: 1,
      });
    }

    return { added: wanted.size, removed };
  }

  /** Сверка «по событию» — правка доступа в панели. Не бросает. */
  async refresh(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      void this.errors.report({ error, source: 'queue', context: 'accounting-orders:schedule' });
    }
  }

  /** Заведённые задачи — для карточки «Очереди». */
  async jobs(): Promise<IAccountingOrdersScheduledJob[]> {
    const rows: IAccountingOrdersScheduledJob[] = [];
    for (const job of await this.queue.getRepeatableJobs()) {
      const telegramUserId = parseAccountingOrdersJobId(job.id);
      if (telegramUserId) rows.push({ telegramUserId, cron: job.cron, tz: job.tz, next: job.next });
    }
    return rows;
  }
}
