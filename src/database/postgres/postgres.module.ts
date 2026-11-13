import type { TFinanceDb } from './finance-db';

import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { AppConfigService } from '../../config/app-config.service';
import { ErrorReporter } from '../../modules/errors/error-reporter.service';

import { FINANCE_DB, MIGRATIONS_FOLDER, MIGRATIONS_TABLE } from './finance-db';
import { financeSchema } from './finance.schema';
import { AccountingAllocationSettingsRepository } from './repositories/accounting-allocation-settings.repository';
import { AccountingCostHistoryRepository } from './repositories/accounting-cost-history.repository';
import { AccountingCostSettingsRepository } from './repositories/accounting-cost-settings.repository';
import { AccountingLotRepository } from './repositories/accounting-lot.repository';
import { AccountingManualOperationRepository } from './repositories/accounting-manual-operation.repository';
import { AccountingOrderLineRepository } from './repositories/accounting-order-line.repository';
import { AccountingOrderResultRepository } from './repositories/accounting-order-result.repository';
import { AccountingTaxSettingsRepository } from './repositories/accounting-tax-settings.repository';
import { FinanceActServicesRepository } from './repositories/finance-act-services.repository';
import { FinanceAnomalyRepository } from './repositories/finance-anomaly.repository';
import { FinanceCorrectionRepository } from './repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from './repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from './repositories/finance-document.repository';
import { FinanceExpenseRepository } from './repositories/finance-expense.repository';
import { FinanceOperationRepository } from './repositories/finance-operation.repository';
import { FinanceOzonBalanceRepository } from './repositories/finance-ozon-balance.repository';
import { FinancePeriodRepository } from './repositories/finance-period.repository';
import { FinancePurchaseRepository } from './repositories/finance-purchase.repository';
import { FinanceSyncRunRepository } from './repositories/finance-sync-run.repository';
import { FinanceTaxSettingsRepository } from './repositories/finance-tax-settings.repository';
import { FinanceTaxYearRepository } from './repositories/finance-tax-year.repository';

/** DI-токен пула — его пингует самопроверка и закрывает shutdown. */
export const POSTGRES_POOL = Symbol('POSTGRES_POOL');

/**
 * Жизненный цикл пула: миграции при старте и закрытие при остановке.
 *
 * Миграции НЕ ждутся в bootstrap и не роняют приложение: урок `lazyConnection`
 * у Mongo — недоступная база не должна оставлять бота без голоса. Сбой уходит
 * в ErrorReporter (алерт админам), самопроверка покажет Postgres «down», а
 * финансовые запросы до применения миграций упадут понятной ошибкой «нет
 * таблицы». Повторная попытка — следующий рестарт или `npm run db:pg:migrate`.
 */
@Injectable()
class PostgresLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Postgres');

  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(FINANCE_DB) private readonly db: TFinanceDb,
    private readonly errors: ErrorReporter,
  ) {}

  onApplicationBootstrap(): void {
    void migrate(this.db as Parameters<typeof migrate>[0], {
      migrationsFolder: MIGRATIONS_FOLDER,
      ...MIGRATIONS_TABLE,
    })
      .then(() => this.logger.log('Миграции Postgres применены'))
      .catch((error: unknown) => {
        this.logger.error(`Миграции Postgres не применились: ${(error as Error).message}`);
        void this.errors.report({ error, source: 'process', context: 'postgres:migrate' });
      });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Postgres — только для финансов (M16–M25, решение `finance_postgres`); всё
 * остальное живёт в Mongo через DatabaseModule. Не @Global: кому нужны
 * финансы, импортирует модуль явно, как DatabaseModule.
 *
 * Пул ленивый — соединения открываются на первом запросе, поэтому недоступная
 * база не мешает старту. `connectionTimeoutMillis` обязателен: по умолчанию pg
 * ждёт соединения бесконечно, и запрос к мёртвой базе висел бы вечно.
 */
@Module({
  providers: [
    {
      provide: POSTGRES_POOL,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const pool = new Pool({
          connectionString: config.postgresUrl,
          max: 10,
          connectionTimeoutMillis: 10_000,
          idleTimeoutMillis: 30_000,
        });
        // Без обработчика ошибка простаивающего соединения (рестарт базы)
        // роняет процесс как необработанное событие 'error'.
        pool.on('error', (error) => new Logger('Postgres').warn(`Пул: ${error.message}`));
        return pool;
      },
    },
    {
      provide: FINANCE_DB,
      inject: [POSTGRES_POOL],
      useFactory: (pool: Pool): TFinanceDb => drizzle(pool, { schema: financeSchema }),
    },
    PostgresLifecycle,
    FinanceOperationRepository,
    FinanceDocumentRepository,
    FinanceCorrectionRepository,
    FinancePeriodRepository,
    FinanceSyncRunRepository,
    AccountingManualOperationRepository,
    AccountingCostHistoryRepository,
    AccountingOrderLineRepository,
    AccountingOrderResultRepository,
    FinanceDiscrepancyRepository,
    FinanceActServicesRepository,
    FinanceOzonBalanceRepository,
    FinanceAnomalyRepository,
    FinanceExpenseRepository,
    FinanceTaxSettingsRepository,
    AccountingAllocationSettingsRepository,
    AccountingCostSettingsRepository,
    AccountingTaxSettingsRepository,
    FinancePurchaseRepository,
    AccountingLotRepository,
    FinanceTaxYearRepository,
  ],
  exports: [
    POSTGRES_POOL,
    FINANCE_DB,
    FinanceOperationRepository,
    FinanceDocumentRepository,
    FinanceCorrectionRepository,
    FinancePeriodRepository,
    FinanceSyncRunRepository,
    AccountingManualOperationRepository,
    AccountingCostHistoryRepository,
    AccountingOrderLineRepository,
    AccountingOrderResultRepository,
    FinanceDiscrepancyRepository,
    FinanceActServicesRepository,
    FinanceOzonBalanceRepository,
    FinanceAnomalyRepository,
    FinanceExpenseRepository,
    FinanceTaxSettingsRepository,
    AccountingAllocationSettingsRepository,
    AccountingCostSettingsRepository,
    AccountingTaxSettingsRepository,
    FinancePurchaseRepository,
    AccountingLotRepository,
    FinanceTaxYearRepository,
  ],
})
export class PostgresModule {}
