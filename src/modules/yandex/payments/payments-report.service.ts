import type { IPaymentsRange } from './payments.domain';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { pollReportFile } from '../report-poll';
import { YandexClientFactory } from '../yandex-client.factory';

import { paymentsCaption, paymentsFileName } from './payments.domain';

/**
 * Добыча отчёта по платежам (united-netting): generate → поллинг → скачивание.
 *
 * Формат FILE — готовый xlsx Маркета уходит продавцу как есть, файл не
 * парсится (в отличие от CSV остатков FBY). Поллинг — общий `pollReportFile`;
 * у платёжного отчёта нет ни лимита 1/мин, ни мемо — single-flight не нужен,
 * дедупом двойного тапа занимается очередь (isQueuedFor).
 *
 * API-only: читает Partner API, Mongo не трогает.
 */

/** Готовый к отправке документ, либо признак «за период данных нет». */
export interface IPaymentsReportResult {
  file: { buffer: Buffer; filename: string; caption: string } | null;
}

@Injectable()
export class PaymentsReportService {
  constructor(private readonly clients: YandexClientFactory) {}

  public async build(
    store: YandexMarketDocument,
    range: IPaymentsRange,
    now: Date = new Date(),
  ): Promise<IPaymentsReportResult> {
    const client = this.clients.forStore(store);

    const reportId = await client.generateUnitedNettingReport(range);
    // DONE без файла — «данных нет» (substatus NO_DATA), а не сбой: пустой
    // период у нового магазина — нормальный ответ.
    const fileUrl = await pollReportFile(client, reportId, {
      failedError: 'Отчёт по платежам не сгенерировался',
      notReadyError: 'Отчёт по платежам не готов вовремя',
    });

    if (!fileUrl) return { file: null };

    const buffer = await client.downloadReportFile(fileUrl);
    return {
      file: {
        buffer,
        filename: paymentsFileName(range, now),
        caption: paymentsCaption(range, now),
      },
    };
  }
}
