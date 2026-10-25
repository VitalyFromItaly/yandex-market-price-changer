import type { TFinanceMarketplace } from '../../../../database/postgres/finance.schema';
import type { IFinanceScreenMonth } from '../../../finance/finance-screen';
import type { IFinanceImportJob } from '../processors/finance-import.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bull';

import { AppConfigService } from '../../../../config/app-config.service';
import { FinancePeriodRepository } from '../../../../database/postgres/repositories/finance-period.repository';
import { MarketplaceConnectionService } from '../../../../database/services/marketplace-connection.service';
import { UserAccessService } from '../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { FINANCE_REPORT_TYPE, financePeriodKey } from '../../../finance/finance-period';
import { MOSCOW_TIME_ZONE } from '../../../yandex/reports/moscow-day';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

import {
  financeCron,
  financeJobId,
  financePullCooldownUntil,
  financePullJobId,
  parseFinanceJobId,
  pickFinanceMarketplaces,
} from './finance-schedule';

/** Повторяемая задача продавца — то, что видит карточка в панели. */
export interface IFinanceScheduledJob {
  telegramUserId: string;
  cron: string;
  tz: string;
  next: number;
}

/** Итог кнопки «Загрузить из Маркета»: что поставлено и что ждёт кулдауна. */
export interface IFinancePullResult {
  /** «ГГГГ-ММ» поставленных (или уже стоявших) загрузок. */
  queued: string[];
  /** Месяцы, грузившиеся меньше 15 минут назад: когда была попытка и когда можно снова. */
  cooldown: { month: string; checkedAt: string; until: string }[];
}

/** Продавцу журнал этой площадки не положен: фича закрыта или площадка не подключена. */
export class FinancePullNotAllowedError extends Error {
  constructor() {
    super('Журнал этой площадки не загружается: она не подключена или «Финансы» закрыты.');
    this.name = 'FinancePullNotAllowedError';
  }
}

/**
 * Ночная загрузка финжурнала (TASK-112) — по ОДНОЙ повторяемой задаче на
 * продавца в очереди `finance-import`.
 *
 * Очередь своя, не `reports`: `ReportSchedulerService.reconcile` снимает на
 * `reports` всё, чего нет в ReportSchedule, — и снял бы наши задачи на каждом
 * старте. Здесь сверка обратная и узкая: трогает только id с префиксом
 * `finance-` (не двоеточие — см. FINANCE_JOB_PREFIX).
 *
 * Сверяется при старте и после правки доступа в панели (`refresh`): открыв
 * продавцу фичу, админ не должен перезапускать контейнер. Процессор всё равно
 * перепроверяет право перед загрузкой — на случай задачи, оставшейся от
 * прошлой сверки.
 */
@Injectable()
export class FinanceImportScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(FinanceImportScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.FINANCE_IMPORT) private readonly queue: Queue,
    private readonly access: UserAccessService,
    private readonly stores: YandexMarketService,
    private readonly config: AppConfigService,
    private readonly errors: ErrorReporter,
    private readonly connections: MarketplaceConnectionService,
    private readonly periods: FinancePeriodRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const { added, removed } = await this.reconcile();
      this.logger.log(`Загрузка финансов по расписанию: +${added} −${removed}`);
    } catch (error) {
      // Подняться приложению это не мешает: без расписания финансы не
      // обновятся ночью, бот работает (политика остальных планировщиков).
      this.logger.error('Не удалось сверить расписание загрузки финансов', error as Error);
    }
  }

  /**
   * Чьи журналы и каких площадок грузить — по Mongo, одним `$in` на площадку.
   * Задача на продавца одна, площадки проходит процессор (TASK-131).
   */
  async wantedMarketplaces(): Promise<Map<string, TFinanceMarketplace[]>> {
    const accounts = await this.access.list();
    const adminIds = this.config.telegramAdminIds;
    const ids = [...new Set([...accounts.map((a) => a.telegramUserId), ...adminIds.map(String)])];
    if (!ids.length) return new Map();

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
    return pickFinanceMarketplaces(accounts, adminIds, { ym, ozon, wb });
  }

  /** Кому положена загрузка хоть одной площадки. */
  async wanted(): Promise<string[]> {
    return [...(await this.wantedMarketplaces()).keys()];
  }

  /** Площадки одного продавца — перепроверка процессора перед ночным проходом. */
  async marketplacesFor(telegramUserId: string): Promise<TFinanceMarketplace[]> {
    return (await this.wantedMarketplaces()).get(telegramUserId) ?? [];
  }

  /** Право одного продавца хоть на одну площадку. */
  async isEligible(telegramUserId: string): Promise<boolean> {
    return (await this.marketplacesFor(telegramUserId)).length > 0;
  }

  /**
   * Свести задачи `finance-*` к списку `wanted()`: совпали id и cron —
   * оставить (повторное заведение той же задачи Bull не дублирует, но
   * снимать-ставить на каждом старте незачем), иначе снять; недостающие —
   * завести. Чужие повторяемые задачи очереди не трогаются.
   */
  async reconcile(): Promise<{ added: number; removed: number }> {
    const wanted = new Map((await this.wanted()).map((id) => [financeJobId(id), financeCron(id)]));
    let removed = 0;

    for (const job of await this.queue.getRepeatableJobs()) {
      if (!parseFinanceJobId(job.id)) continue;
      if (job.id && wanted.get(job.id) === job.cron) {
        wanted.delete(job.id);
        continue;
      }
      await this.queue.removeRepeatableByKey(job.key);
      removed += 1;
    }

    for (const [jobId, cron] of wanted) {
      const payload: IFinanceImportJob = {
        telegramUserId: parseFinanceJobId(jobId) ?? '',
        scheduled: true,
      };
      await this.queue.add(JOB_TYPES.IMPORT_FINANCE, payload, {
        jobId,
        repeat: { cron, tz: MOSCOW_TIME_ZONE },
        removeOnComplete: 20,
        removeOnFail: 50,
        // Одна попытка: следующая ночь всё равно перезагрузит те же месяцы, а
        // повтор жжёт квоту 100 генераций в час.
        attempts: 1,
      });
    }

    return { added: wanted.size, removed };
  }

  /**
   * Сверка «по событию» — после правки доступа в панели. Не бросает: флаг уже
   * записан, и ответить панели «не получилось» из-за Redis значило бы соврать.
   */
  async refresh(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      void this.errors.report({ error, source: 'queue', context: 'finance-import:schedule' });
    }
  }

  /**
   * «Загрузить из Маркета» (кнопка CRM): разовая задача на месяц в ту же
   * очередь и тот же `@Process`, что ночной проход. Право — то же правило, что
   * у расписания (`marketplacesFor`): фича `finance` (и площадки) плюс
   * подключённый ключ. Месяц, который грузили меньше 15 минут назад, не ставится —
   * он уходит в `cooldown` с временем, а не ошибкой: остальные месяцы периода
   * ставятся. id задачи — продавец, площадка и месяц: повторный клик, пока
   * задача ждёт или идёт, Bull второй не ставит; после неё задача удаляется.
   */
  async pullNow(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    months: readonly IFinanceScreenMonth[],
    now: Date = new Date(),
  ): Promise<IFinancePullResult> {
    if (!(await this.marketplacesFor(telegramUserId)).includes(marketplace)) {
      throw new FinancePullNotAllowedError();
    }
    const result: IFinancePullResult = { queued: [], cooldown: [] };
    for (const { month, period } of months) {
      const row = await this.periods.find({
        marketplace,
        telegramUserId,
        periodKey: financePeriodKey(FINANCE_REPORT_TYPE[marketplace], period),
      });
      const until = financePullCooldownUntil(row?.checkedAt ?? null, now);
      if (until) {
        const checkedAt = row.checkedAt.toISOString();
        result.cooldown.push({ month, checkedAt, until: until.toISOString() });
        continue;
      }
      const payload: IFinanceImportJob = { telegramUserId, marketplace, ...period };
      await this.queue.add(JOB_TYPES.IMPORT_FINANCE, payload, {
        jobId: financePullJobId(telegramUserId, marketplace, month),
        removeOnComplete: true,
        removeOnFail: true,
        // Одна попытка: повтор жжёт квоту, а продавец увидит сбой и нажмёт сам.
        attempts: 1,
      });
      result.queued.push(month);
    }
    return result;
  }

  /** Заведённые задачи загрузки — для карточки «Очереди». */
  async jobs(): Promise<IFinanceScheduledJob[]> {
    const rows: IFinanceScheduledJob[] = [];
    for (const job of await this.queue.getRepeatableJobs()) {
      const telegramUserId = parseFinanceJobId(job.id);
      if (telegramUserId) rows.push({ telegramUserId, cron: job.cron, tz: job.tz, next: job.next });
    }
    return rows;
  }
}
