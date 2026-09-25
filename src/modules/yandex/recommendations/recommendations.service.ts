import type { IRecommendationsWorkbook } from './recommendations-workbook';
import type { IPriceRecommendation } from './recommendations.domain';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { YandexClientFactory } from '../yandex-client.factory';

import { recommendationsFileName } from './recommendations-message';
import { buildRecommendationsWorkbook } from './recommendations-workbook';
import { sortByDeltaDesc } from './recommendations.domain';

/** Срез рекомендаций: строки, момент съёмки и книга (null — строк нет). */
export interface IRecommendationsReport {
  /** Худшие сверху (`sortByDeltaDesc`), без порога — в конце. */
  rows: IPriceRecommendation[];
  takenAt: Date;
  workbook: (IRecommendationsWorkbook & { filename: string }) | null;
}

/**
 * «Рекомендации цен» — ядро на оба канала: загрузка, порядок строк и книга.
 *
 * Бот рисует из отчёта текст и шлёт файл, CRM — таблицу и тот же файл. Магазин
 * приходит готовым (бот — активный, CRM — перекрытый ключом из адреса), как у
 * `QuarantineService`. Момент среза один на текст, таблицу и имя файла.
 */
@Injectable()
export class RecommendationsService {
  constructor(private readonly clients: YandexClientFactory) {}

  async build(
    store: YandexMarketDocument,
    now: Date = new Date(),
  ): Promise<IRecommendationsReport> {
    const loaded = await this.clients.forStore(store).loadPriceRecommendations();
    const rows = sortByDeltaDesc(loaded);
    const workbook = rows.length
      ? { ...buildRecommendationsWorkbook(rows), filename: recommendationsFileName(now) }
      : null;
    return { rows, takenAt: now, workbook };
  }
}
