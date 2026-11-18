import type { IYmRegionRow } from './ym-regions.domain';
import type { YandexApiClient } from '../yandex-api.client';

import { Injectable, Logger } from '@nestjs/common';

import { YmRegionService } from '../../../database/services/ym-region.service';

import { regionRowOf } from './ym-regions.domain';

/** Сколько неизвестных регионов спрашивать у Маркета за один отчёт (суточный лимит метода). */
export const REGION_LOOKUPS_PER_REPORT = 200;

/**
 * Регионы справочника Маркета, поднятые до субъекта, с кэшем в Mongo (`YmRegion`).
 *
 * Сбой справочника отчёт не роняет: регион без строки кэша подписывается своим именем
 * (`regionLabel`), и следующий отчёт попробует снова.
 */
@Injectable()
export class YmRegionsService {
  private readonly logger = new Logger(YmRegionsService.name);

  constructor(private readonly cache: YmRegionService) {}

  async resolve(
    client: YandexApiClient,
    ids: readonly number[],
  ): Promise<Map<number, IYmRegionRow>> {
    const known = await this.cache.findByIds(ids);
    const missing = ids.filter((id) => !known.has(id)).slice(0, REGION_LOOKUPS_PER_REPORT);
    if (!missing.length) return known;

    const fetched: IYmRegionRow[] = [];
    for (const id of missing) {
      try {
        const row = regionRowOf(await client.getRegion(id));
        if (row) fetched.push(row);
      } catch (error) {
        this.logger.warn(`Регион ${id} не получен, в отчёте будет своим именем: ${String(error)}`);
        break;
      }
    }

    await this.cache.saveMany(fetched);
    for (const row of fetched) known.set(row.regionId, row);
    return known;
  }
}
