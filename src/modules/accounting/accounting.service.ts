import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TFinanceSyncOutcome, TFinanceSyncTrigger } from '../finance/finance-sync';

import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { FinanceSyncRunRepository } from '../../database/postgres/repositories/finance-sync-run.repository';
import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { MARKETPLACE_LABEL } from '../../shared/marketplace';
import { financeToday } from '../finance/finance-period';
import {
  FINANCE_SYNC_TRIGGER_LABEL,
  isSyncSuccess,
  reloadWindow,
  syncWindowRows,
} from '../finance/finance-sync';
import { isMarketplaceFeatureOpen } from '../marketplaces/marketplace-connections.domain';

/** Состояние раздела «Финучёт» для CRM. Каркас: экранов ещё нет. */
export interface IAccountingStatus {
  ready: boolean;
}

/** Подпись исхода попытки загрузки для экрана. */
export const SYNC_OUTCOME_LABEL: Record<TFinanceSyncOutcome, string> = {
  empty: 'Загружено: операций нет',
  unchanged: 'Загружено: без изменений',
  imported: 'Загружено',
  failed: 'Сбой',
  'not-connected': 'Площадка не подключена',
};

export interface IAccountingSyncPeriodView {
  /** «ГГГГ-ММ». */
  month: string;
  from: string;
  to: string;
  lastAttemptAt: string | null;
  outcome: TFinanceSyncOutcome | null;
  outcomeLabel: string | null;
  trigger: TFinanceSyncTrigger | null;
  triggerLabel: string | null;
  attempt: number | null;
  error: string | null;
  lastSuccessAt: string | null;
  /** В окне, а успешной загрузки нет — поставится в очередь сам. */
  missed: boolean;
}

export interface IAccountingSyncMarketplaceView {
  marketplace: TFinanceMarketplace;
  label: string;
  /** Последний успех по площадке — «данные на …». null — успеха не было. */
  lastSuccessAt: string | null;
  periods: IAccountingSyncPeriodView[];
}

/** Журнал синхронизации на экране «Финучёта» (TASK-212). */
export interface IAccountingSyncView {
  /** Самый ранний «последний успех» среди площадок — данные всего раздела не новее него. */
  asOf: string | null;
  everyHours: number;
  reloadMonths: number;
  marketplaces: IAccountingSyncMarketplaceView[];
}

const iso = (at: Date | null | undefined) => (at ? at.toISOString() : null);

/**
 * «Финучёт» (M29, решение accounting_beside_current): второй механизм учёта рядом
 * с текущим расчётом прибыли. Каркас TASK-206; журнал синхронизации — TASK-212.
 * Текущий расчёт (pnl.ts, order-feed.ts, returns-analytics.ts, profit-actual.ts)
 * отсюда не зовётся и не меняется.
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly syncRuns: FinanceSyncRunRepository,
    private readonly stores: YandexMarketService,
    private readonly connections: MarketplaceConnectionService,
    private readonly config: AppConfigService,
  ) {}

  status(): IAccountingStatus {
    return { ready: false };
  }

  /**
   * Состояние загрузки по площадкам продавца и месяцам окна перезагрузки:
   * последняя попытка, её исход и ошибка, последний УСПЕХ отдельно, пропуски.
   * Площадки — подключённые и открытые фичами (ЯМ — магазин с кредами), то
   * же правило, что у расписания.
   */
  async syncStatus(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    now: Date = new Date(),
  ): Promise<IAccountingSyncView> {
    const marketplaces = await this.marketplacesOf(telegramUserId, features);
    const reloadMonths = this.config.finAccountingReloadMonths;
    const window = reloadWindow(financeToday(now), reloadMonths);
    const states = await this.syncRuns.states(telegramUserId, marketplaces);
    const rows = syncWindowRows(marketplaces, window, states);

    const views = marketplaces.map((marketplace): IAccountingSyncMarketplaceView => {
      const own = rows.filter((row) => row.marketplace === marketplace);
      const successes = states
        .filter((state) => state.marketplace === marketplace && state.lastSuccessAt)
        .map((state) => state.lastSuccessAt.getTime());
      return {
        marketplace,
        label: MARKETPLACE_LABEL[marketplace],
        lastSuccessAt: successes.length ? new Date(Math.max(...successes)).toISOString() : null,
        periods: own.map(({ period, state, missed }) => ({
          month: period.from.slice(0, 7),
          from: period.from,
          to: period.to,
          lastAttemptAt: iso(state?.lastAttemptAt),
          outcome: state?.lastOutcome ?? null,
          outcomeLabel: state ? SYNC_OUTCOME_LABEL[state.lastOutcome] : null,
          trigger: state?.lastTrigger ?? null,
          triggerLabel: state ? FINANCE_SYNC_TRIGGER_LABEL[state.lastTrigger] : null,
          attempt: state?.lastAttempt ?? null,
          error: state && !isSyncSuccess(state.lastOutcome) ? state.lastError : null,
          lastSuccessAt: iso(state?.lastSuccessAt),
          missed,
        })),
      };
    });

    const known = views.map((view) => view.lastSuccessAt);
    const asOf = known.length && known.every(Boolean) ? [...known].sort()[0] : null;
    return {
      asOf,
      everyHours: this.config.finAccountingSyncEveryHours,
      reloadMonths,
      marketplaces: views,
    };
  }

  /**
   * Площадки «Финучёта» продавца: ЯМ — магазин с кредами, Ozon/WB — подключены и
   * открыты фичами. Одно правило на расписание, журнал загрузки и налог (TASK-221).
   */
  async marketplacesOf(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
  ): Promise<TFinanceMarketplace[]> {
    const [store, ozon, wb] = await Promise.all([
      this.stores.findByTelegramUser(telegramUserId),
      this.connections.connectedUsers('ozon', [telegramUserId]),
      this.connections.connectedUsers('wb', [telegramUserId]),
    ]);
    const result: TFinanceMarketplace[] = [];
    if (store?.campaign_id && store.business_id && store.token) result.push('ym');
    if (ozon.has(telegramUserId) && isMarketplaceFeatureOpen(features, 'ozon')) result.push('ozon');
    if (wb.has(telegramUserId) && isMarketplaceFeatureOpen(features, 'wb')) result.push('wb');
    return result;
  }
}
