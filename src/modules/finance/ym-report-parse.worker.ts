import type { TYmReportKind } from './ym-report-parse';

import { parentPort, workerData } from 'node:worker_threads';

import { parseYmReportSync } from './ym-report-parse';

/**
 * Воркер разбора финансового отчёта ЯМ — `parseYmReport` в `ym-report-parse.ts`
 * (там же — почему). Ошибка разбора уходит сообщением: так её русский текст
 * доходит до задачи как есть.
 */
const { kind, buffer } = workerData as { kind: TYmReportKind; buffer: Uint8Array };

try {
  parentPort?.postMessage({ ok: true, result: parseYmReportSync(kind, buffer) });
} catch (error) {
  parentPort?.postMessage({ ok: false, message: (error as Error).message });
}
