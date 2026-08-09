import type { TMarketReportKey } from './market-reports.domain';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { paymentsRange, type TPaymentsPeriod } from '../payments/payments.domain';
import { pollReportFile } from '../report-poll';
import {
  competitorsPositionGeneratePath,
  goodsRealizationGeneratePath,
  goodsTurnoverGeneratePath,
  keyIndicatorsGeneratePath,
  salesGeographyGeneratePath,
  showsSalesGeneratePath,
} from '../yandex-api.paths';
import { YandexClientFactory } from '../yandex-client.factory';

import {
  MARKET_REPORT_META,
  mktCaption,
  mktFileName,
  mktPeriodLine,
} from './market-reports.domain';

/**
 * Сборка одного из шести отчётов Маркета: тело generate по типу → общий
 * поллинг → скачивание. Формат FILE — xlsx Маркета уходит как есть (паттерн
 * «Платежи»). API-only, Mongo не трогает.
 *
 * Параметры приходят из payload джобы БЕЗ дат: период задан ключом, а даты
 * считаются здесь, на момент отправки (довод платежей — «с 1 числа» на момент
 * постановки и отправки может отличаться).
 */

/** Параметры отчёта из payload джобы. Состав зависит от типа отчёта. */
export interface IMarketReportParams {
  /** real */
  year?: number;
  month?: number;
  /** comp */
  categoryId?: number;
  /** comp, shows, geo */
  periodKey?: TPaymentsPeriod;
  /** shows: CATEGORIES | OFFERS */
  grouping?: string;
  /** key: WEEK | MONTH */
  detalizationLevel?: string;
}

export interface IMarketReportResult {
  file: { buffer: Buffer; filename: string; caption: string } | null;
}

@Injectable()
export class MarketReportsService {
  constructor(private readonly clients: YandexClientFactory) {}

  public async build(
    store: YandexMarketDocument,
    key: TMarketReportKey,
    params: IMarketReportParams,
    now: Date = new Date(),
  ): Promise<IMarketReportResult> {
    const client = this.clients.forStore(store);
    const { path, body, paramsLine } = this.request(store, key, params, now);

    const reportId = await client.generateReport(path, body);
    const meta = MARKET_REPORT_META[key];
    const fileUrl = await pollReportFile(client, reportId, {
      failedError: `Отчёт «${meta.title}» не сгенерировался`,
      notReadyError: `Отчёт «${meta.title}» не готов вовремя`,
    });

    if (!fileUrl) return { file: null };

    const buffer = await client.downloadReportFile(fileUrl);
    return {
      file: {
        buffer,
        filename: mktFileName(key, now),
        caption: mktCaption(key, paramsLine, now),
      },
    };
  }

  /**
   * Путь и тело generate по типу отчёта. Идентификаторы — ЧИСЛОМ в теле
   * (прецедент generateUnitedNettingReport); у businessId/campaignId-пар шлётся
   * ровно один (XOR по спеке).
   */
  private request(
    store: YandexMarketDocument,
    key: TMarketReportKey,
    params: IMarketReportParams,
    now: Date,
  ): { path: string; body: Record<string, unknown>; paramsLine: string } {
    const campaignId = Number(store.campaign_id);
    const businessId = Number(store.business_id);

    switch (key) {
      case 'real': {
        const year = params.year ?? 0;
        const month = params.month ?? 0;
        return {
          path: goodsRealizationGeneratePath(),
          body: { campaignId, year, month },
          paramsLine: `Месяц: ${String(month).padStart(2, '0')}.${year}`,
        };
      }
      case 'turn':
        // Дата не передаётся — Маркет берёт текущую.
        return {
          path: goodsTurnoverGeneratePath(),
          body: { campaignId },
          paramsLine: '',
        };
      case 'comp': {
        const range = paymentsRange(params.periodKey ?? 'month', now);
        return {
          path: competitorsPositionGeneratePath(),
          body: {
            businessId,
            categoryId: params.categoryId,
            dateFrom: range.dateFrom,
            dateTo: range.dateTo,
          },
          paramsLine: mktPeriodLine(range),
        };
      }
      case 'shows': {
        const range = paymentsRange(params.periodKey ?? 'month', now);
        return {
          path: showsSalesGeneratePath(),
          body: {
            businessId,
            dateFrom: range.dateFrom,
            dateTo: range.dateTo,
            grouping: params.grouping ?? 'CATEGORIES',
          },
          paramsLine: mktPeriodLine(range),
        };
      }
      case 'key':
        return {
          path: keyIndicatorsGeneratePath(),
          body: { businessId, detalizationLevel: params.detalizationLevel ?? 'WEEK' },
          paramsLine:
            params.detalizationLevel === 'MONTH' ? 'Детализация: месяцы' : 'Детализация: недели',
        };
      case 'geo': {
        const range = paymentsRange(params.periodKey ?? 'month', now);
        return {
          path: salesGeographyGeneratePath(),
          body: { businessId, dateFrom: range.dateFrom, dateTo: range.dateTo },
          paramsLine: mktPeriodLine(range),
        };
      }
    }
  }
}
