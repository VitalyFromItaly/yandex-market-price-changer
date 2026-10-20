import type { IReportInfo, YandexApiClient } from './yandex-api.client';

import { ReportGenerationError } from './report-generation.error';
import { realSleep, type TSleep } from './yandex-retry';

/**
 * Общий цикл ожидания асинхронного отчёта Маркета: poll GET reports/info до
 * DONE/FAILED/таймаута.
 *
 * Вынесен, когда потребителей стало три (платежи, раздел «Отчёты Маркета», и
 * исторически fby-stock): три копии одного цикла — это ровно тот код, который
 * расходится. `fby-stock.service.ts` остаётся на своём цикле НАМЕРЕННО: у него
 * поверх поллинга мемо и single-flight под лимит генерации 1/мин, и общий
 * хелпер их не выразит.
 */

export interface IReportPollOptions {
  intervalMs?: number;
  maxAttempts?: number;
  /** Текст ошибки, когда Маркет ответил FAILED. */
  failedError: string;
  /** Текст ошибки, когда отчёт не готов за maxAttempts. */
  notReadyError: string;
  /** Подменяется в тестах. */
  sleep?: TSleep;
}

const DEFAULT_INTERVAL_MS = 2500;
/** ~3 минуты — безопасно: все потребители крутятся в процессорах очереди. */
const DEFAULT_MAX_ATTEMPTS = 72;

/**
 * Ссылка на готовый файл, либо null — DONE без файла означает «данных за
 * период нет» (substatus NO_DATA), это ответ, а не сбой.
 *
 * FAILED и таймаут бросают `ReportGenerationError`, а не голый Error: текст
 * тот же, но журнал получает reportId, subStatus и времена Маркета — без них
 * «почему отчёт не сгенерировался» снова решался бы через docker logs и curl
 * (урок fby-stock, 12–13-10-2026).
 */
export async function pollReportFile(
  client: YandexApiClient,
  reportId: string,
  options: IReportPollOptions,
): Promise<string | null> {
  const sleep = options.sleep ?? realSleep;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const startedAt = Date.now();
  let last: IReportInfo | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    last = await client.getReportInfo(reportId);
    if (last.status === 'DONE') return last.fileUrl ?? null;
    if (last.status === 'FAILED') {
      const reason = last.subStatus ? ` (Маркет: ${last.subStatus})` : '';
      throw new ReportGenerationError(
        `${options.failedError}${reason}`,
        reportId,
        last,
        Date.now() - startedAt,
      );
    }
    await sleep(intervalMs);
  }

  throw new ReportGenerationError(options.notReadyError, reportId, last, Date.now() - startedAt);
}
