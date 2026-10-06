import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { buildFbyWorkbook, fbyFileName } from '../../yandex/fby/fby-workbook';
import { moscowClock, moscowDateParam } from '../../yandex/reports/moscow-day';
import { WarehousesService } from '../../yandex/warehouses/warehouses.service';
import { XLSX_TYPE } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import { toCrmWarehousesView, WAREHOUSES_JOB_KIND } from './crm-warehouses.domain';

/**
 * Kind «Склады»: тот же `WarehousesService.overview`, что у процессора бота.
 * Файл — книга остатков «FBY» (`buildFbyWorkbook`) из того же снимка отчёта:
 * продавец ищет «наличие на складе» именно здесь, а лишнего запроса к Маркету
 * нет — снимок общий через `FbyStockService`. Бот в «Складах» файла не шлёт.
 * Модель магазина проверяет `assertFeatures` (`warehouses` — FBY-only фича).
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
    const workbook = data.stock
      ? {
          ...buildFbyWorkbook(data.stock),
          filename: fbyFileName(moscowDateParam(now), moscowClock(now)),
        }
      : null;
    return {
      data: toCrmWarehousesView(data, now, workbook),
      file: workbook
        ? { buffer: workbook.buffer, filename: workbook.filename, contentType: XLSX_TYPE }
        : null,
    };
  }
}
