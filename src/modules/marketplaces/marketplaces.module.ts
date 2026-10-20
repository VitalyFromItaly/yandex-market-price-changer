import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { FinanceModule } from '../finance/finance.module';
import { OzonModule } from '../ozon/ozon.module';
import { WbModule } from '../wb/wb.module';
import { YandexModule } from '../yandex/yandex.module';

import { MarketplaceConnectionsService } from './marketplace-connections.service';
import { MarketplaceRegistry } from './marketplace-registry.service';
import { YmConnectionAdapter } from './ym-connection.adapter';
import { YmMarketplaceAdapter } from './ym-marketplace.adapter';

/**
 * Площадки: адаптеры и сводка подключений (TASK-127). Отдельным модулем, а не
 * внутри YandexModule: адаптеру нужен и импорт финансов, а FinanceModule уже
 * импортирует YandexModule — адаптер там замкнул бы цикл. Отсюда стрелки идут
 * только наружу: ни Yandex, ни Finance, ни Ozon этот модуль не импортируют.
 * Ozon и WB — ради их адаптеров (пока только подключение, TASK-162).
 */
@Module({
  imports: [DatabaseModule, YandexModule, FinanceModule, OzonModule, WbModule],
  providers: [
    YmMarketplaceAdapter,
    YmConnectionAdapter,
    MarketplaceRegistry,
    MarketplaceConnectionsService,
  ],
  // Адаптеры наружу не отдаются: потребитель ходит только через реестр (TASK-162).
  exports: [MarketplaceRegistry, MarketplaceConnectionsService],
})
export class MarketplacesModule {}
