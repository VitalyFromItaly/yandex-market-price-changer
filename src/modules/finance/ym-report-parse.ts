import { extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { unzipReportJson } from '../yandex/report-zip';

import { compactYmServicesSheet } from './ym-act-breakdown';
import { nettingRowsOf } from './ym-journal';

/**
 * Разбор финансовых отчётов ЯМ (format=JSON — ZIP по JSON на лист) в отдельном
 * потоке `worker_threads`.
 *
 * Почему воркер (MemoryPressureError 13–15.11.2026, частый и ночной импорт журнала
 * ЯМ у 406937947): RSS +2,6 ГБ за минуту при heapTotal ~200 МБ, плюс `job stalled`
 * и `MongoDB readyState=0`. Синхронный разбор месячного отчёта (распакованные байты,
 * строка JSON с кириллицей по два байта на символ, сырые объекты) на десятки секунд
 * занимал цикл событий всего бота: Bull терял блокировку задачи, драйвер Mongo —
 * heartbeat, а замер памяти на `setInterval` пик не видел. Ужать сам разбор
 * (по листу, выжимка — `a50759f`) этого не сняло.
 *
 * В воркере весь этот транзиент живёт в отдельном изоляте и уходит из процесса
 * вместе с ним. Обратно приходит только нужное: строки журнала или выжимка листов
 * услуг. Цикл событий основного процесса остаётся свободным. Отчёт, который не
 * влезает в `YM_REPORT_WORKER_HEAP_MB`, роняет воркер, а не бота: задача падает
 * понятной ошибкой и уходит в `ErrorReporter`, как любая ошибка импорта.
 *
 * Воркер запускается только из собранного `dist` (`.js` рядом). Под ts-node и
 * vitest по умолчанию разбор идёт в процессе: тот же код без воркера. Тест воркера
 * включает его явно (`{ worker: true }`) через `ts-node/register`.
 */

export type TYmReportKind = 'netting' | 'services';

export interface IYmReportParsed {
  /** Строки листа `transaction_date` отчёта united-netting. */
  netting: Record<string, unknown>[];
  /** Листы отчёта united-marketplace-services, каждый — выжимка `compactYmServicesSheet`. */
  services: Map<string, unknown>;
}

/**
 * Потолок кучи воркера. Старый синхронный разбор доходил до ~2,6 ГБ RSS на весь
 * процесс (база ~160 МБ, часть — буферы вне кучи), поэтому ниже 2 ГБ рискуем
 * навсегда остаться без журнала месяца. Выше — съедим контейнер (4 ГБ).
 */
export const YM_REPORT_WORKER_HEAP_MB = 2560;

/** Разбор в текущем потоке — то же, что делает воркер. */
export function parseYmReportSync<K extends TYmReportKind>(
  kind: K,
  buffer: Uint8Array,
): IYmReportParsed[K] {
  const parsed =
    kind === 'netting'
      ? nettingRowsOf(unzipReportJson(buffer))
      : unzipReportJson(buffer, compactYmServicesSheet);
  return parsed as IYmReportParsed[K];
}

const SELF_EXT = extname(__filename);

export async function parseYmReport<K extends TYmReportKind>(
  kind: K,
  buffer: Uint8Array,
  options: { worker?: boolean } = {},
): Promise<IYmReportParsed[K]> {
  const worker = options.worker ?? SELF_EXT === '.js';
  if (!worker) return parseYmReportSync(kind, buffer);
  return await runWorker(kind, buffer);
}

interface IWorkerReply {
  ok: boolean;
  result?: unknown;
  message?: string;
}

function runWorker<K extends TYmReportKind>(
  kind: K,
  buffer: Uint8Array,
): Promise<IYmReportParsed[K]> {
  return new Promise((resolve, reject) => {
    // Буфер копируется (structured clone), а не передаётся: исходный ZIP ещё
    // нужен импорту — он сохраняется как оригинал документа.
    const worker = new Worker(join(__dirname, `ym-report-parse.worker${SELF_EXT}`), {
      workerData: { kind, buffer },
      resourceLimits: { maxOldGenerationSizeMb: YM_REPORT_WORKER_HEAP_MB },
      execArgv: SELF_EXT === '.ts' ? ['--require', 'ts-node/register/transpile-only'] : [],
    });
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    worker.once('message', (reply: IWorkerReply) =>
      settle(() =>
        reply.ok
          ? resolve(reply.result as IYmReportParsed[K])
          : reject(new Error(reply.message ?? 'Разбор отчёта ЯМ упал без сообщения')),
      ),
    );
    worker.once('error', (error: Error & { code?: string }) =>
      settle(() =>
        reject(
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new Error(
                `Отчёт ЯМ (${kind}) не уложился в ${YM_REPORT_WORKER_HEAP_MB} МБ при разборе — ` +
                  'воркер остановлен, бот продолжает работать',
              )
            : error,
        ),
      ),
    );
    worker.once('exit', (code) =>
      settle(() => reject(new Error(`Воркер разбора отчёта ЯМ завершился с кодом ${code}`))),
    );
  });
}
