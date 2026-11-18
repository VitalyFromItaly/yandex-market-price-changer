import type { IYmRegionRow } from '../../modules/yandex/regions/ym-regions.domain';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { YmRegion, YmRegionDocument } from '../schemas/ym-region.schema';

/** Кэш справочника регионов Маркета (`YmRegion`). */
@Injectable()
export class YmRegionService {
  constructor(
    @InjectModel(YmRegion.name)
    private readonly model: Model<YmRegionDocument>,
  ) {}

  async findByIds(ids: readonly number[]): Promise<Map<number, IYmRegionRow>> {
    if (!ids.length) return new Map();
    const rows = await this.model
      .find(
        { regionId: { $in: [...ids] } },
        { _id: 0, regionId: 1, name: 1, subject: 1, district: 1 },
      )
      .lean<IYmRegionRow[]>();
    return new Map(rows.map((row) => [row.regionId, row]));
  }

  /** Upsert по `regionId` — повторная запись того же региона безопасна. */
  async saveMany(rows: readonly IYmRegionRow[]): Promise<void> {
    if (!rows.length) return;
    await this.model.bulkWrite(
      rows.map((row) => ({
        updateOne: { filter: { regionId: row.regionId }, update: { $set: row }, upsert: true },
      })),
      { ordered: false },
    );
  }
}
