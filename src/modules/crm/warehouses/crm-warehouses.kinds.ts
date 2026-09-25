import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { WarehousesService } from '../../yandex/warehouses/warehouses.service';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import { toCrmWarehousesView, WAREHOUSES_JOB_KIND } from './crm-warehouses.domain';

/**
 * Kind «Склады»: тот же `WarehousesService.overview`, что у процессора бота.
 * Файла нет — бот его не шлёт. Модель магазина проверяет `assertFeatures`
 * (`warehouses` — FBY-only фича).
 */
@Injectable()
export class CrmWarehousesKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly warehouses: WarehousesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(WAREHOUSES_JOB_KIND, {
      features: [FEATURE.WAREHOUSES],
      run: (context) => this.run(context),
    });
  }

  async run(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const data = await this.warehouses.overview(context.store);
    return { data: toCrmWarehousesView(data, now), file: null };
  }
}
