import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';

import { unzipSync } from 'fflate';
import mongoose from 'mongoose';

import { YandexMarketSchema } from '../src/database/schemas/yandex-market.schema';
import { financeToday, monthPeriod, requestRange } from '../src/modules/finance/finance-period';
import { compactYmServicesSheet } from '../src/modules/finance/ym-act-breakdown';
import { pollReportFile } from '../src/modules/yandex/report-poll';
import { unzipReportJson } from '../src/modules/yandex/report-zip';
import { YandexApiClient } from '../src/modules/yandex/yandex-api.client';
import {
  unitedMarketplaceServicesGeneratePath,
  unitedNettingGeneratePath,
} from '../src/modules/yandex/yandex-api.paths';

/**
 * Память разбора финансовых отчётов ЯМ (MemoryPressureError 13.11.2026: частый импорт
 * журнала у 406937947 — +2,6 ГБ RSS за минуту при heap 197 МБ).
 *
 * Скачивает united-netting и united-marketplace-services за месяц — те же отчёты,
 * что `FinanceImportService.importPeriod` / `servicesSheets`, — и печатает размеры
 * листов (сжатый/распакованный) и `process.memoryUsage()` по стадиям для старого
 * разбора (`unzipSync` всех листов сразу) и нового (`unzipReportJson` по листу, для
 * услуг — с выжимкой `compactYmServicesSheet`). Оба способа идут в одном процессе:
 * новый первым (на чистом RSS), старый вторым. Сравнивать по heapTotal/arrayBuffers —
 * RSS после первого прохода аллокатор в ОС уже не вернёт.
 *
 * ТОЛЬКО ЧИТАЕТ: Mongo — findOne, Partner API — generate отчёта (заказ файла, тратит
 * квоту 1/мин и 100/ч на кабинет — не запускать во время частого импорта), reports/info,
 * скачивание. Nest не поднимается — AppModule перевесил бы вебхук боевого бота.
 *
 *   node --expose-gc -r ts-node/register scripts/diagnose-finance-memory.ts \
 *     --user=<telegramUserId> [--month=2026-11] [--services-month=2026-10] \
 *     [--save=<dir>] [--from=<dir>]
 *
 * --save — сохранить скачанные ZIP (netting.zip, services.zip), --from — разобрать
 * сохранённые без Маркета (тогда --user не нужен и Mongo не трогается).
 */

const DEFAULT_BASE_URL = 'https://api.partner.market.yandex.ru';
const MB = 1024 * 1024;

interface IArgs {
  user?: string;
  month: string;
  servicesMonth: string;
  save?: string;
  from?: string;
}

function parseArgs(argv: string[]): IArgs {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const month = get('month') ?? financeToday().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const args = { user: get('user'), month, servicesMonth: get('services-month') ?? prev };
  if (!get('from') && !args.user) throw new Error('Нужен --user=<telegramUserId> или --from=<dir>');
  return { ...args, save: get('save'), from: get('from') };
}

const gc = (): void => (global as { gc?: () => void }).gc?.();

function mem(stage: string): void {
  const u = process.memoryUsage();
  const f = (n: number) => String(Math.round(n / MB)).padStart(5);
  console.log(
    `  ${stage.padEnd(44)} rss ${f(u.rss)}  heapUsed ${f(u.heapUsed)}  heapTotal ${f(u.heapTotal)}` +
      `  external ${f(u.external)}  arrayBuffers ${f(u.arrayBuffers)} МБ`,
  );
}

function listEntries(buffer: Uint8Array): void {
  unzipSync(buffer, {
    filter: (file) => {
      console.log(
        `    ${file.name.padEnd(40)} сжато ${(file.size / MB).toFixed(1)} МБ, ` +
          `распаковано ${(file.originalSize / MB).toFixed(1)} МБ`,
      );
      return false;
    },
  });
}

function countRows(sheets: Map<string, unknown>): string {
  return [...sheets]
    .map(([name, data]) => {
      const rows = (data as { rows?: unknown[] } | null)?.rows;
      return `${name}=${Array.isArray(rows) ? rows.length : '?'}`;
    })
    .join(', ');
}

/** Старый разбор: все листы распакованы разом, затем строка и JSON каждого. */
function oldParse(buffer: Uint8Array): Map<string, unknown> {
  const entries = unzipSync(buffer);
  mem('старый: после unzipSync всех листов');
  const decoder = new TextDecoder('utf-8');
  const sheets = new Map<string, unknown>();
  for (const [name, content] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const text = decoder.decode(content);
    mem(`старый: decode ${name} (${Math.round(text.length / MB)} М симв.)`);
    sheets.set(name, JSON.parse(text));
    mem(`старый: JSON.parse ${name}`);
  }
  return sheets;
}

function measure(title: string, buffer: Uint8Array, compact: boolean): void {
  console.log(`\n=== ${title}: архив ${(buffer.length / MB).toFixed(1)} МБ`);
  listEntries(buffer);
  gc();
  mem('до разбора (после gc)');

  {
    const fresh = unzipReportJson(buffer, compact ? compactYmServicesSheet : undefined);
    mem(`новый: unzipReportJson${compact ? ' + выжимка' : ''}`);
    console.log(`    строк: ${countRows(fresh)}`);
  }
  gc();
  mem('новый: отпущено (gc)');

  {
    const old = oldParse(buffer);
    mem(`старый: всё разобрано (листов ${old.size})`);
  }
  gc();
  mem('старый: отпущено (gc)');
}

async function download(
  client: YandexApiClient,
  path: string,
  body: Record<string, unknown>,
): Promise<Buffer | null> {
  const started = Date.now();
  const reportId = await client.generateReport(path, body, 'JSON');
  const fileUrl = await pollReportFile(client, reportId, {
    intervalMs: 5000,
    maxAttempts: 120,
    failedError: `Маркет не сформировал отчёт (reportId ${reportId})`,
    notReadyError: `Отчёт не готов за 10 минут (reportId ${reportId})`,
  });
  console.log(`  ${path}: готов за ${Math.round((Date.now() - started) / 1000)} с`);
  return fileUrl ? client.downloadReportFile(fileUrl) : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!(global as { gc?: unknown }).gc) console.log('Без --expose-gc: «отпущено» будет неточным.');
  mem('старт');

  let netting: Buffer | null;
  let services: Buffer | null;
  if (args.from) {
    netting = readFileSync(`${args.from}/netting.zip`);
    services = readFileSync(`${args.from}/services.zip`);
  } else {
    const url = process.env.MONGODB_URL;
    const dbName = process.env.MONGODB_DATABASE;
    if (!url || !dbName) throw new Error('Нужны MONGODB_URL и MONGODB_DATABASE в .env');
    await mongoose.connect(url, { dbName });
    const Store = mongoose.model('YandexMarket', YandexMarketSchema);
    const store = await Store.findOne({ telegramUserId: args.user }).lean<{
      token?: string;
      campaign_id?: string;
      business_id?: string;
    }>();
    await mongoose.disconnect();
    if (!store?.token) throw new Error(`Магазин ${args.user} не найден или без токена`);

    const client = new YandexApiClient(
      { token: store.token, campaignId: store.campaign_id, businessId: store.business_id },
      process.env.YANDEX_MARKET_BASE_URL ?? DEFAULT_BASE_URL,
    );
    const businessId = Number(store.business_id);
    const today = financeToday();
    const rangeOf = (month: string) =>
      requestRange(monthPeriod(Number(month.slice(0, 4)), Number(month.slice(5, 7))), today);

    const n = rangeOf(args.month);
    netting = await download(client, unitedNettingGeneratePath(), {
      businessId,
      dateFrom: n.from,
      dateTo: n.to,
    });
    // Минутный лимит генерации на кабинет — как generateWithMinuteLimit.
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    const s = rangeOf(args.servicesMonth);
    services = await download(client, unitedMarketplaceServicesGeneratePath(), {
      businessId,
      dateFrom: s.from,
      dateTo: s.to,
    });
    if (args.save) {
      if (netting) writeFileSync(`${args.save}/netting.zip`, netting);
      if (services) writeFileSync(`${args.save}/services.zip`, services);
    }
  }
  mem('скачано');

  if (netting) measure(`united-netting ${args.month}`, netting, false);
  else console.log('\nunited-netting: DONE без файла');
  if (services) measure(`united-marketplace-services ${args.servicesMonth}`, services, true);
  else console.log('\nunited-marketplace-services: DONE без файла');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
