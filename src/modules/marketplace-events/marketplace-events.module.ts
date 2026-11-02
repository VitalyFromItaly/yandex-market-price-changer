import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { TelegramModule } from '../telegram/telegram.module';

import { MarketplaceEventsController } from './marketplace-events.controller';
import { MarketplaceEventsService } from './marketplace-events.service';

/**
 * Уведомления площадок о заказах (`stock_push_on_marketplace_event`). Планировщик
 * прохода — из TelegramModule (там очередь file-processing), как у CRM-«Прайса».
 */
@Module({
  imports: [DatabaseModule, forwardRef(() => TelegramModule)],
  controllers: [MarketplaceEventsController],
  providers: [MarketplaceEventsService],
})
export class MarketplaceEventsModule {}
