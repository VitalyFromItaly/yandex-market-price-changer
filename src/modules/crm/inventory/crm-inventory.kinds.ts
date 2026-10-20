import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { InventoryService } from '../../inventory/inventory.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import { INVENTORY_KIND, toCrmInventory } from './crm-inventory.domain';

/**
 * «Склад» (TASK-142) — kind уровня аккаунта под `inventory` (она требует
 * `finance` сама). Доставка: площадки собирает `InventoryService` (те же числа
 * читают правила уведомлений), здесь — перечисление полей ответа.
 */
@Injectable()
export class CrmInventoryKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly inventory: InventoryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(INVENTORY_KIND, {
      features: [FEATURE.INVENTORY],
      scope: 'account',
      run: (context) => this.summary(context),
    });
  }

  async summary(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const snapshot = await this.inventory.build({
      telegramUserId: context.telegramUserId,
      store: context.store,
      features: context.features ?? {},
      now,
      movements: true,
    });
    return {
      data: toCrmInventory(snapshot.inventory, {
        now,
        columns: snapshot.columns,
        problems: snapshot.problems,
        notes: snapshot.notes,
      }),
    };
  }
}
