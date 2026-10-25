import 'dotenv/config';
import axios, { type AxiosInstance } from 'axios';
import mongoose from 'mongoose';

import { YandexMarketSchema } from '../src/database/schemas/yandex-market.schema';
import {
  reportInfoPath,
  stocksOnWarehousesGeneratePath,
} from '../src/modules/yandex/yandex-api.paths';

/**
 * Почему отчёт остатков FBY (`stocks-on-warehouses`) проваливается.
 *
 * 20-10-2026 Маркет принял отчёт и через секунду вернул FAILED без
 * `subStatus` (так же падал повтор утром 13-10). Решение — что чинить у нас —
 * зависит от ответа на три вопроса, которые журнал ошибок не отвечает:
 *
 *  Q1. Падает ли отчёт у этой кампании стабильно или это разовый сбой
 *      Маркета (`--repeat`).
 *  Q2. Падает ли только CSV — или и другие форматы (`--format`).
 *  Q3. Что Маркет отдаёт по уже проваленному отчёту целиком (`--report`):
 *      бот печатает лишь поля, которые знает.
 *
 * Запросы идут своим axios, а не через YandexApiClient: нужен СЫРОЙ ответ
 * (включая errors/warnings, которые клиент отбрасывает), и ради диагностики
 * не меняется прод-код. Повторов на ошибках нет — каждая видна как есть.
 *
 * Скрипт ТОЛЬКО ЧИТАЕТ: Mongo — findOne, Partner API — POST generate
 * (семантически чтение: заказывает отчёт, ничего не меняет) и GET reports/info.
 * Генерация лимитирована (1 в 2 минуты на бизнес без подписки), поэтому между
 * повторами пауза 130 с — и не запускайте скрипт, пока продавец жмёт кнопки
 * FBY/«Склады»: оба упрутся в лимит.
 *
 * Запуск:
 *   npx ts-node scripts/diagnose-fby-stock.ts --user=<telegramUserId>
 *   npx ts-node scripts/diagnose-fby-stock.ts --user=<id> --repeat=3
 *   npx ts-node scripts/diagnose-fby-stock.ts --user=<id> --format=JSON   # CSV (дефолт, как бот) | FILE | JSON
 *   npx ts-node scripts/diagnose-fby-stock.ts --user=<id> --report=<reportId>   # только опрос, без генерации
 */

const DEFAULT_BASE_URL = 'https://api.partner.market.yandex.ru';
const FORMATS = ['CSV', 'FILE', 'JSON'] as const;
type TFormat = (typeof FORMATS)[number];

/** Как у FbyStockService: опрос раз в 5 с, потолок 10 минут. */
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 120;
/** Окно лимита генерации (1 в 2 минуты) с запасом. */
const REPEAT_PAUSE_MS = 130_000;

interface IArgs {
  user: string;
  format: TFormat;
  repeat: number;
  report?: string;
}

interface IRawInfo {
  status?: string;
  subStatus?: string;
  file?: string;
  generationRequestedAt?: string;
  generationFinishedAt?: string;
  estimatedGenerationTime?: number;
}

function parseArgs(argv: string[]): IArgs {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

  const user = value('user');
  if (!user) throw new Error('Нужен --user=<telegramUserId>. Он же в админ-карточке пользователя.');

  const rawFormat = (value('format') ?? 'CSV').toUpperCase();
  const format = FORMATS.find((f) => f === rawFormat);
  if (!format) throw new Error(`Не понял --format=${rawFormat}. Варианты: ${FORMATS.join(', ')}.`);

  const repeat = Number(value('repeat') ?? 1);
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat — целое число от 1.');

  return { user, format, repeat, report: value('report') };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (data: unknown) => JSON.stringify(data, null, 2);

/** Тело ошибки Маркета вместо голого «Request failed with status code 420». */
function describe(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return `HTTP ${error.response?.status ?? '—'}: ${json(error.response?.data ?? error.message)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Опрос до DONE/FAILED/потолка. Печатает каждый ответ, отличный от предыдущего. */
async function poll(http: AxiosInstance, reportId: string): Promise<IRawInfo | undefined> {
  const startedAt = Date.now();
  let previous = '';
  let last: IRawInfo | undefined;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const { data } = await http.get<{ result?: IRawInfo }>(reportInfoPath(reportId));
    last = data.result;
    const raw = json(data);
    if (raw !== previous) {
      console.log(`  [+${Math.round((Date.now() - startedAt) / 1000)} с] reports/info:\n${raw}`);
      previous = raw;
    }
    if (last?.status === 'DONE' || last?.status === 'FAILED') return last;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(`  Не готов за ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 60_000} мин.`);
  return last;
}

/** Размер файла — доказательство, что отчёт не просто DONE, а с данными. */
async function fileSize(url: string): Promise<string> {
  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 60_000,
    });
    return `${Buffer.from(response.data).length} байт`;
  } catch (error) {
    return `не скачался — ${describe(error)}`;
  }
}

function summary(info: IRawInfo | undefined): string {
  if (!info) return 'нет ответа';
  const parts = [
    info.status ?? '—',
    info.subStatus ? `subStatus ${info.subStatus}` : 'без subStatus',
    `принят ${info.generationRequestedAt ?? '—'}`,
    `закончен ${info.generationFinishedAt ?? '—'}`,
  ];
  return parts.join(' · ');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.MONGODB_URL;
  const dbName = process.env.MONGODB_DATABASE;
  if (!url || !dbName) throw new Error('Нужны MONGODB_URL и MONGODB_DATABASE в .env');

  await mongoose.connect(url, { dbName });
  const Store = mongoose.model('YandexMarket', YandexMarketSchema);
  const store = await Store.findOne({ telegramUserId: args.user }).lean<{
    token?: string;
    campaign_id?: string;
    business_id?: string;
    stores?: Array<{ campaignId: string; storeName: string; placementType?: string }>;
  }>();
  // Дальше скрипт работает только с Partner API — Mongo больше не нужна.
  await mongoose.disconnect();

  if (!store?.token) throw new Error(`Магазин пользователя ${args.user} не найден или без токена.`);

  const entry = store.stores?.find((s) => s.campaignId === store.campaign_id);
  console.log('─'.repeat(72));
  console.log(`  МАГАЗИН:   ${entry?.storeName ?? '(нет в кэше stores)'}`);
  console.log(`  КАМПАНИЯ:  ${store.campaign_id} · бизнес ${store.business_id}`);
  console.log(`  МОДЕЛЬ:    ${entry?.placementType ?? '(не определена)'}`);
  console.log('─'.repeat(72));

  const http = axios.create({
    baseURL: process.env.YANDEX_MARKET_BASE_URL ?? DEFAULT_BASE_URL,
    timeout: 30_000,
    headers: { 'Api-Key': store.token, 'Content-Type': 'application/json' },
  });

  if (args.report) {
    console.log(`\nОпрос существующего отчёта ${args.report}`);
    const info = await poll(http, args.report).catch((error: unknown) => {
      console.log(`  ✖ ${describe(error)}`);
      return undefined;
    });
    console.log(`\nИтог: ${summary(info)}`);
    return;
  }

  const results: string[] = [];
  for (let run = 1; run <= args.repeat; run += 1) {
    if (run > 1) {
      console.log(`\nПауза ${REPEAT_PAUSE_MS / 1000} с — лимит генерации…`);
      await sleep(REPEAT_PAUSE_MS);
    }
    console.log(`\n▶ Прогон ${run}/${args.repeat}, формат ${args.format}`);
    try {
      // Тот же запрос, что у бота: формат в query, кампания в теле.
      const { data } = await http.post<{ result?: { reportId?: string } }>(
        stocksOnWarehousesGeneratePath(),
        { campaignId: Number(store.campaign_id) },
        { params: { format: args.format } },
      );
      console.log(`  generate:\n${json(data)}`);
      const reportId = data.result?.reportId;
      if (!reportId) {
        results.push(`${run}: generate без reportId`);
        continue;
      }
      const info = await poll(http, reportId);
      const file =
        info?.status === 'DONE' && info.file ? ` · файл ${await fileSize(info.file)}` : '';
      results.push(`${run}: ${reportId} · ${summary(info)}${file}`);
    } catch (error) {
      console.log(`  ✖ ${describe(error)}`);
      results.push(`${run}: ошибка запроса — ${describe(error).split('\n')[0]}`);
    }
  }

  console.log(`\n${'─'.repeat(72)}\nИТОГ (${args.format}):`);
  for (const line of results) console.log(`  ${line}`);
}

main().catch(async (error: Error) => {
  console.error(`\n❌ ${error.message}`);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
