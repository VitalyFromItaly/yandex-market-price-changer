import type { IHealthSampleRow } from '../../modules/metrics/metrics.domain';

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { HealthSample, HealthSampleDocument } from '../schemas/health-sample.schema';

@Injectable()
export class HealthSampleService {
  private readonly logger = new Logger(HealthSampleService.name);

  constructor(
    @InjectModel(HealthSample.name)
    private readonly model: Model<HealthSampleDocument>,
  ) {}

  /**
   * Записать образцы одного прохода самопроверки.
   *
   * Никогда не бросает: монитор обязан работать при лежащей Mongo (ради этого
   * он и на setInterval, а не на Bull), и запись истории — побочная функция.
   */
  async record(samples: readonly IHealthSampleRow[]): Promise<void> {
    if (samples.length === 0) return;
    try {
      await this.model.insertMany(
        samples.map((sample) => ({ ...sample, at: new Date(sample.at) })),
        { ordered: false },
      );
    } catch (error) {
      this.logger.warn(`Не удалось записать образцы самопроверки: ${(error as Error).message}`);
    }
  }

  /** Образцы окна по возрастанию времени. */
  async findSince(since: Date, keys: readonly string[]): Promise<IHealthSampleRow[]> {
    return await this.model
      .find({ key: { $in: keys }, at: { $gte: since } })
      .select({ _id: 0, at: 1, key: 1, state: 1, latencyMs: 1 })
      .sort({ at: 1 })
      .lean<IHealthSampleRow[]>()
      .exec();
  }
}
