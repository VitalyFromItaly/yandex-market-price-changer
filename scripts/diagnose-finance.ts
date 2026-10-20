import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import mongoose from 'mongoose';

import { YandexMarketSchema } from '../src/database/schemas/yandex-market.schema';
import { FINANCE_ARTICLE_META } from '../src/modules/finance/finance-articles';
import { monthPeriod } from '../src/modules/finance/finance-period';
import { kopecksToRub, toKopecks } from '../src/modules/finance/kopecks';
import { ymActBreakdownOf, ymActDayOf } from '../src/modules/finance/ym-act-breakdown';
import { classifyYmRow, isYmActSummaryRow } from '../src/modules/finance/ym-articles';
import { journalKeys } from '../src/modules/finance/ym-journal';
import { pollReportFile } from '../src/modules/yandex/report-poll';
import { unzipReportJson } from '../src/modules/yandex/report-zip';
import { YandexApiClient } from '../src/modules/yandex/yandex-api.client';
import {
  goodsRealizationGeneratePath,
  unitedMarketplaceServicesGeneratePath,
  unitedNettingGeneratePath,
  unitedOrdersGeneratePath,
  unitedReturnsGeneratePath,
} from '../src/modules/yandex/yandex-api.paths';

/**
 * Разведка финансовых отчётов Маркета (TASK-108).
 *
 * Зачем. Фактическая прибыль будет строиться из журнала операций (решение
 * finance_actual_beside_flat), и схему журнала нельзя проектировать по
 * описанию в спеке: у /returns форма ответа уже однажды оказалась не той, что
 * у /orders, и отчёт молча был пустым. Скрипт заказывает пять отчётов за месяц
 * в format=JSON (ZIP с JSON на каждый лист) и печатает: листы, колонки с
 * заполненностью, значения колонок-«типов» с числом строк и Σ сумм со знаком,
 * колонки-идентификаторы и их уникальность, а если уникального id нет — набор
 * полей, который уникален.
 *
 * Скрипт ТОЛЬКО ЧИТАЕТ: Mongo — findOne, Partner API — generate отчёта (это
 * заказ файла, а не запись), reports/info, скачивание. Nest не поднимается —
 * AppModule перевесил бы вебхук боевого бота (довод diagnose-*).
 *
 * Квоты: у всех пяти отчётов 100 генераций в час. Отчёты идут строго по
 * одному, с паузой между заказами; повторы — руками и через --only.
 *
 * Запуск:
 *   npx ts-node scripts/diagnose-finance.ts --user=<telegramUserId>
 *     [--month=MM-YYYY]   по умолчанию прошлый месяц по Москве
 *     [--only=services|netting|orders|returns|realization]
 *     [--dump=<каталог>]  сохранить листы как есть, для сверки повторного прогона
 *     [--campaign]        сузить отчёты до активного магазина (иначе весь кабинет)
 *     [--compare=<каталог>] сверить ключи строк журнала с дампом прошлого прогона
 *   npx ts-node scripts/diagnose-finance.ts --from-dump=<каталог> [--compare=<каталог>]
 *     разобрать сохранённые листы заново — без Mongo и без единого запроса к Маркету
 *
 * Что выяснено этим скриптом (09-2026, решение finance_ym_report_map в tasks.json):
 * у строк журнала united-netting НЕТ идентификатора (transactionId всегда null),
 * а полностью одинаковые строки встречаются — две штуки одного товара в заказе
 * идут двумя строками. Поэтому ключ — содержимое устойчивых полей плюс порядковый
 * номер среди одинаковых (journalKeys). Поля платёжки (paymentStatus, bankOrder*)
 * в ключ не входят: они меняются, когда Маркет переводит деньги.
 *
 * Блок «СТАТЬИ ЖУРНАЛА» прогоняет строки через классификатор ym-articles.ts
 * (TASK-110): Σ по статьям и группам и каждый нераспознанный тип отдельно.
 */

const DEFAULT_BASE_URL = 'https://api.partner.market.yandex.ru';
const RULE = '─'.repeat(72);
/** Пауза между генерациями: квота часовая, но долбить её подряд незачем. */
const PAUSE_MS = 3000;
/** Колонка с бо́льшим числом разных значений — уже не «тип», а данные. */
const MAX_TYPE_VALUES = 80;
/** Перебор комбинаций полей для ключа дедупа — не глубже. */
const MAX_KEY_FIELDS = 4;

type TReportKey = 'services' | 'netting' | 'orders' | 'returns' | 'realization';
type TRow = Record<string, unknown>;

interface IArgs {
  user: string;
  year: number;
  month: number;
  only?: TReportKey;
  dump?: string;
  campaign: boolean;
  compare?: string;
  fromDump?: string;
}

const REPORT_KEYS: readonly TReportKey[] = [
  'services',
  'netting',
  'orders',
  'returns',
  'realization',
];

function parseArgs(argv: string[]): IArgs {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

  const fromDump = get('from-dump');
  const user = get('user') ?? '';
  if (!user && !fromDump)
    throw new Error('Нужен --user=<telegramUserId>. Он же в админ-карточке пользователя.');

  let year: number;
  let month: number;
  const rawMonth = get('month');
  if (rawMonth) {
    const m = /^(\d{2})-(\d{4})$/.exec(rawMonth);
    if (!m) throw new Error('--month в формате MM-YYYY, например 09-2026');
    month = Number(m[1]);
    year = Number(m[2]);
  } else {
    // Прошлый месяц по Москве: МСК = UTC+3 без перехода на летнее время.
    const msk = new Date(Date.now() + 3 * 3600_000);
    month = msk.getUTCMonth(); // 0..11 текущего = 1..12 прошлого
    year = msk.getUTCFullYear();
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }

  const only = get('only') as TReportKey | undefined;
  if (only && !REPORT_KEYS.includes(only)) {
    throw new Error(`--only: одно из ${REPORT_KEYS.join(', ')}`);
  }

  return {
    user,
    year,
    month,
    only,
    dump: get('dump'),
    campaign: argv.includes('--campaign'),
    compare: get('compare'),
    fromDump,
  };
}

function monthRange(year: number, month: number): { dateFrom: string; dateTo: string } {
  const { from, to } = monthPeriod(year, month);
  return { dateFrom: from, dateTo: to };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Строки листа: массив объектов как есть, иначе — первый массив объектов внутри. */
function rowsOf(sheet: unknown): { rows: TRow[]; shape: string } {
  if (Array.isArray(sheet))
    return { rows: sheet.filter(isObject).map((row) => flatten(row)), shape: 'array' };
  if (isObject(sheet)) {
    for (const [key, value] of Object.entries(sheet)) {
      if (Array.isArray(value) && value.some(isObject)) {
        return {
          rows: value.filter(isObject).map((row) => flatten(row)),
          shape: `object.${key}[]`,
        };
      }
    }
    return { rows: [], shape: `object{${Object.keys(sheet).join(', ')}}` };
  }
  return { rows: [], shape: typeof sheet };
}

function isObject(value: unknown): value is TRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Вложенные объекты — в пути через точку: колонки должны быть плоскими. */
function flatten(row: TRow, prefix = ''): TRow {
  const out: TRow = {};
  for (const [key, value] of Object.entries(row)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) Object.assign(out, flatten(value, path));
    else out[path] = Array.isArray(value) ? JSON.stringify(value) : value;
  }
  return out;
}

function kindOf(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') {
    if (/^-?\d+([.,]\d+)?$/.test(value)) return 'numstr';
    if (/^\d{4}-\d{2}-\d{2}/.test(value) || /^\d{2}\.\d{2}\.\d{4}/.test(value)) return 'date';
    return 'string';
  }
  return typeof value;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+([.,]\d+)?$/.test(value.trim())) {
    return Number(value.trim().replace(',', '.'));
  }
  return null;
}

const fmtMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Колонки-суммы: числовые, и имя похоже на деньги. */
function moneyColumns(columns: string[], rows: TRow[]): string[] {
  return columns.filter((c) => {
    if (!/amount|sum|price|cost|total|value|payment|сумм|стоим|цен|итог|руб/i.test(c)) return false;
    if (/count|quantity|qty|кол|weight|вес|id$/i.test(c)) return false;
    return rows.some((r) => toNumber(r[c]) !== null);
  });
}

/** Колонки-идентификаторы по имени. */
function idColumns(columns: string[]): string[] {
  return columns.filter((c) => /(^|[._])id$|_id$|Id$|ID|номер|sku|offer|артикул/i.test(c));
}

function isUnique(rows: TRow[], fields: string[]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify(fields.map((f) => row[f] ?? null));
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function* combinations(items: string[], size: number, start = 0): Generator<string[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = start; i <= items.length - size; i += 1) {
    for (const rest of combinations(items, size - 1, i + 1)) yield [items[i], ...rest];
  }
}

/**
 * Наименьший набор полей, уникальный на листе. Перебираются сначала id-колонки,
 * потом все остальные, кроме сумм: деньги в ключе дедупа — это ключ, который
 * меняется, когда Маркет пересчитал строку, то есть дубль при повторной загрузке.
 */
function minimalKey(
  rows: TRow[],
  ids: string[],
  columns: string[],
  money: string[],
): string[] | null {
  const rest = columns.filter((c) => !ids.includes(c) && !money.includes(c));
  const pool = [...ids, ...rest].filter((c) => rows.some((r) => kindOf(r[c]) !== 'empty'));
  for (let size = 1; size <= Math.min(MAX_KEY_FIELDS, pool.length); size += 1) {
    for (const fields of combinations(pool.slice(0, 24), size)) {
      if (isUnique(rows, fields)) return fields;
    }
  }
  return null;
}

interface ISheetSummary {
  report: TReportKey;
  sheet: string;
  rows: number;
  money: Record<string, number>;
}

function analyseSheet(report: TReportKey, sheet: string, data: unknown): ISheetSummary {
  const { rows, shape } = rowsOf(data);
  console.log();
  console.log(`  ЛИСТ «${sheet}» — ${shape}, строк ${rows.length}`);
  if (!rows.length) {
    console.log(`    сырое начало: ${JSON.stringify(data).slice(0, 400)}`);
    return { report, sheet, rows: 0, money: {} };
  }

  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  console.log('    КОЛОНКИ (тип · заполнено · пример):');
  for (const column of columns) {
    const kinds = new Map<string, number>();
    let filled = 0;
    let example: unknown;
    for (const row of rows) {
      const kind = kindOf(row[column]);
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      if (kind !== 'empty') {
        filled += 1;
        example ??= row[column];
      }
    }
    const kindText = [...kinds]
      .filter(([k]) => k !== 'empty')
      .map(([k]) => k)
      .join('|');
    const share = `${Math.round((filled / rows.length) * 100)}%`;
    console.log(
      `      ${column.padEnd(40)} ${(kindText || 'empty').padEnd(14)} ${share.padStart(4)}  ${String(
        JSON.stringify(example) ?? '',
      ).slice(0, 50)}`,
    );
  }

  const money = moneyColumns(columns, rows);
  const totals: Record<string, number> = {};
  for (const column of money) {
    totals[column] = rows.reduce((sum, r) => sum + (toNumber(r[column]) ?? 0), 0);
  }
  if (money.length) {
    console.log('    Σ СУММ ПО ЛИСТУ:');
    for (const column of money)
      console.log(`      ${column.padEnd(40)} ${fmtMoney(totals[column])}`);
  }

  // Колонки-«типы»: строковые с немногими разными значениями — кандидаты на
  // «тип услуги/операции», по которым классификатор (TASK-110) разложит статьи.
  const typeColumns = columns.filter((c) => {
    if (money.includes(c)) return false;
    const values = new Set(rows.map((r) => r[c]).filter((v) => typeof v === 'string' && v !== ''));
    return values.size > 0 && values.size <= MAX_TYPE_VALUES && values.size < rows.length;
  });
  const mainMoney = money[0];
  for (const column of typeColumns) {
    const groups = new Map<string, { n: number; sum: number }>();
    for (const row of rows) {
      const key = String(row[column] ?? '(пусто)');
      const group = groups.get(key) ?? { n: 0, sum: 0 };
      group.n += 1;
      group.sum += mainMoney ? (toNumber(row[mainMoney]) ?? 0) : 0;
      groups.set(key, group);
    }
    console.log(`    ЗНАЧЕНИЯ «${column}»${mainMoney ? ` (Σ по ${mainMoney})` : ''}:`);
    for (const [value, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
      const sum = mainMoney ? `  Σ ${fmtMoney(g.sum)}` : '';
      console.log(`      ${String(g.n).padStart(6)}  ${value.slice(0, 70).padEnd(70)}${sum}`);
    }
  }

  const ids = idColumns(columns);
  console.log('    ИДЕНТИФИКАТОРЫ:');
  if (!ids.length) console.log('      (колонок-идентификаторов по имени нет)');
  for (const column of ids) {
    const filled = rows.filter((r) => kindOf(r[column]) !== 'empty');
    const distinct = new Set(filled.map((r) => String(r[column]))).size;
    console.log(
      `      ${column.padEnd(40)} заполнено ${filled.length}/${rows.length}, разных ${distinct}${
        distinct === rows.length ? '  ← УНИКАЛЕН' : ''
      }`,
    );
  }
  const key = minimalKey(rows, ids, columns, money);
  console.log(
    `    КЛЮЧ ДЕДУПА (минимальный уникальный набор без сумм): ${
      key ? key.join(' + ') : `не найден до ${MAX_KEY_FIELDS} полей`
    }`,
  );

  return { report, sheet, rows: rows.length, money: totals };
}

type TCollected = Map<TReportKey, Map<string, unknown>>;

function readDump(dir: string): TCollected {
  const collected: TCollected = new Map();
  for (const report of REPORT_KEYS) {
    const reportDir = join(dir, report);
    if (!existsSync(reportDir)) continue;
    const sheets = new Map<string, unknown>();
    for (const file of readdirSync(reportDir).filter((f) => f.endsWith('.json'))) {
      sheets.set(
        file.replace(/\.json$/, ''),
        JSON.parse(readFileSync(join(reportDir, file), 'utf8')),
      );
    }
    collected.set(report, sheets);
  }
  return collected;
}

const sumOf = (rows: TRow[], column: string) =>
  rows.reduce((s, r) => s + (toNumber(r[column]) ?? 0), 0);

/**
 * Σ услуг (services) против удержаний за те же услуги в журнале выплат
 * (netting). Знаки противоположны: в services услуга — положительная
 * стоимость, в netting — отрицательное удержание. Связывает их дата акта:
 * services за месяц — это один акт, его строки в netting несут ту же actDate.
 */
function reconcile(collected: TCollected): void {
  const services = collected.get('services');
  const netting = collected.get('netting');
  console.log();
  console.log(RULE);
  console.log('  СВЕРКА services ↔ netting');
  console.log(RULE);
  if (!services || !netting) {
    console.log('  нужны оба отчёта (services и netting) — в этом прогоне их нет');
    return;
  }

  let servicesTotal = 0;
  const actDates = new Set<string>();
  for (const [sheet, data] of services) {
    const { rows } = rowsOf(data);
    // У листа «Размещение» итог — totalAmount (уже за вычетом скидки за
    // лояльность), у остальных — servicePrice.
    const column = rows.some((r) => 'totalAmount' in r) ? 'totalAmount' : 'servicePrice';
    const sum = sumOf(rows, column);
    servicesTotal += sum;
    for (const r of rows) if (typeof r.actDate === 'string') actDates.add(r.actDate);
    console.log(`  services/${sheet.padEnd(32)} ${column.padEnd(14)} ${fmtMoney(sum)}`);
  }
  console.log(`  ${'Σ services'.padEnd(56)} ${fmtMoney(servicesTotal)}`);

  // actDate в services — ГГГГ-ММ-ДД, в netting — ДД.ММ.ГГГГ.
  const acts = new Set([...actDates].map((d) => d.split('-').reverse().join('.')));
  const journal = [...netting.values()].flatMap((d) => rowsOf(d).rows);
  const byAct = journal.filter((r) => typeof r.actDate === 'string' && acts.has(r.actDate));
  const actSum = sumOf(byAct, 'transactionSum');
  console.log(
    `  ${`Σ netting с актом ${[...acts].join(', ')} (${byAct.length} строк)`.padEnd(56)} ${fmtMoney(actSum)}`,
  );
  console.log(
    `  ${'расхождение (services + netting)'.padEnd(56)} ${fmtMoney(servicesTotal + actSum)}`,
  );

  // Списания с бонусного баланса — услуги, оплаченные баллами «совместных
  // акций». Они не деньги и в акт не входят: показываются отдельно, иначе
  // их легко принять за необъяснённую разницу.
  const writeOffs = journal.filter((r) => r.transactionType === 'Списание');
  console.log(
    `  ${`справочно: списания с бонусного баланса (${writeOffs.length})`.padEnd(56)} ${fmtMoney(
      sumOf(writeOffs, 'transactionSum'),
    )}`,
  );
}

function checkJournalKeys(collected: TCollected, compareDir?: string): void {
  const netting = collected.get('netting');
  if (!netting) return;
  const rows = [...netting.values()].flatMap((d) => rowsOf(d).rows);
  const keys = journalKeys(rows);
  console.log();
  console.log(RULE);
  console.log('  КЛЮЧ ДЕДУПА ЖУРНАЛА (netting)');
  console.log(RULE);
  const withId = rows.filter(
    (r) => r.transactionId !== null && r.transactionId !== undefined,
  ).length;
  console.log(`  transactionId заполнен: ${withId} из ${rows.length}`);
  const duplicates = keys.filter((k) => !k.endsWith('#1')).length;
  console.log(`  строк-повторов по содержимому (нужен порядковый номер): ${duplicates}`);
  console.log(`  ключей уникально: ${new Set(keys).size} из ${rows.length}`);

  if (!compareDir) return;
  const previous = readDump(compareDir).get('netting');
  if (!previous) {
    console.log(`  в ${compareDir} нет дампа netting — сравнивать не с чем`);
    return;
  }
  const before = new Set(journalKeys([...previous.values()].flatMap((d) => rowsOf(d).rows)));
  const now = new Set(keys);
  const gone = [...before].filter((k) => !now.has(k)).length;
  const added = [...now].filter((k) => !before.has(k)).length;
  console.log(
    `  против ${compareDir}: было ${before.size}, стало ${now.size}, исчезло ${gone}, появилось ${added}`,
  );
}

/**
 * Журнал по статьям классификатора (TASK-110): Σ по статьям и группам, и
 * отдельно — каждый нераспознанный тип. Ненулевой unknown на живом дампе значит,
 * что в ym-articles.ts пора дописать строку.
 */
function classifyJournal(collected: TCollected): void {
  const netting = collected.get('netting');
  if (!netting) return;
  const rows = [...netting.values()].flatMap((d) => rowsOf(d).rows);
  console.log();
  console.log(RULE);
  console.log('  СТАТЬИ ЖУРНАЛА (ym-articles)');
  console.log(RULE);

  const byArticle = new Map<string, { n: number; sum: number; reversals: number }>();
  const unknown = new Map<string, { n: number; sum: number }>();
  const byGroup = new Map<string, number>();
  for (const row of rows) {
    const { article, reversal, signature } = classifyYmRow(row);
    const sum = toNumber(row.transactionSum) ?? 0;
    const a = byArticle.get(article) ?? { n: 0, sum: 0, reversals: 0 };
    a.n += 1;
    a.sum += sum;
    if (reversal) a.reversals += 1;
    byArticle.set(article, a);
    const group = FINANCE_ARTICLE_META[article].group;
    byGroup.set(group, (byGroup.get(group) ?? 0) + sum);
    if (article === 'unknown') {
      const u = unknown.get(signature) ?? { n: 0, sum: 0 };
      u.n += 1;
      u.sum += sum;
      unknown.set(signature, u);
    }
  }
  for (const [article, a] of [...byArticle].sort((x, y) => y[1].n - x[1].n)) {
    const title = FINANCE_ARTICLE_META[article as keyof typeof FINANCE_ARTICLE_META].title;
    const rev = a.reversals ? `  (сторно: ${a.reversals})` : '';
    console.log(`  ${String(a.n).padStart(6)}  ${title.padEnd(32)} ${fmtMoney(a.sum)}${rev}`);
  }
  console.log('  ПО ГРУППАМ:');
  for (const [group, sum] of byGroup) console.log(`    ${group.padEnd(12)} ${fmtMoney(sum)}`);
  console.log(`  НЕ РАСПОЗНАНО: ${unknown.size ? '' : 'нет'}`);
  for (const [signature, u] of unknown) {
    console.log(`    ${String(u.n).padStart(6)}  ${signature.slice(0, 90)}  ${fmtMoney(u.sum)}`);
  }
}

/**
 * Сводные строки актов по отчёту услуг (TASK-155): та же `ymActBreakdownOf`,
 * что у импорта. Части, Σ и остаток по каждой строке; ненулевой остаток или
 * незнакомый лист значит, что в ym-act-breakdown.ts пора дописать правило.
 */
function actBreakdown(collected: TCollected): void {
  const netting = collected.get('netting');
  const services = collected.get('services');
  if (!netting || !services) return;
  const rows = [...netting.values()].flatMap((d) => rowsOf(d).rows).filter(isYmActSummaryRow);
  console.log();
  console.log(RULE);
  console.log('  РАСШИФРОВКА СВОДНЫХ СТРОК АКТОВ (ym-act-breakdown)');
  console.log(RULE);
  if (!rows.length) console.log('  сводных строк в журнале нет');
  for (const row of rows) {
    const kopecks = toKopecks(row.transactionSum) ?? 0;
    const day = ymActDayOf(row.actDate);
    const result = day ? ymActBreakdownOf(kopecks, day, services) : null;
    console.log(`  акт ${String(row.actId)} от ${String(row.actDate)}: ${fmtMoney(kopecks / 100)}`);
    if (!result) {
      console.log('    в отчёте услуг строк этого акта нет — нужен отчёт за месяц акта');
      continue;
    }
    for (const part of result.parts) {
      const title = FINANCE_ARTICLE_META[part.article].title;
      console.log(
        `    ${(part.sheet ?? 'остаток').padEnd(32)} ${title.padEnd(18)} ` +
          fmtMoney(kopecksToRub(part.kopecks)),
      );
    }
    const sum = result.parts.reduce((s, p) => s + p.kopecks, 0);
    console.log(
      `    Σ частей ${fmtMoney(kopecksToRub(sum))}, остаток ` +
        `${fmtMoney(kopecksToRub(result.remainderKopecks))}` +
        (result.unknownSheets.length
          ? `; незнакомые листы: ${result.unknownSheets.join(', ')}`
          : ''),
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.fromDump) {
    const collected = readDump(args.fromDump);
    const summaries: ISheetSummary[] = [];
    for (const [report, sheets] of collected) {
      console.log();
      console.log(`${RULE}\n  ОТЧЁТ ${report} (из дампа ${args.fromDump})\n${RULE}`);
      for (const [sheet, data] of sheets) summaries.push(analyseSheet(report, sheet, data));
    }
    reconcile(collected);
    checkJournalKeys(collected, args.compare);
    classifyJournal(collected);
    actBreakdown(collected);
    return;
  }

  const url = process.env.MONGODB_URL;
  const dbName = process.env.MONGODB_DATABASE;
  if (!url || !dbName) throw new Error('Нужны MONGODB_URL и MONGODB_DATABASE в .env');

  await mongoose.connect(url, { dbName });
  const Store = mongoose.model('YandexMarket', YandexMarketSchema);
  const store = await Store.findOne({ telegramUserId: args.user }).lean<{
    token?: string;
    campaign_id?: string;
    business_id?: string;
    name?: string;
  }>();
  await mongoose.disconnect();

  if (!store?.token) throw new Error(`Магазин пользователя ${args.user} не найден или без токена.`);

  const client = new YandexApiClient(
    { token: store.token, campaignId: store.campaign_id, businessId: store.business_id },
    process.env.YANDEX_MARKET_BASE_URL ?? DEFAULT_BASE_URL,
  );

  const businessId = Number(store.business_id);
  const campaignId = Number(store.campaign_id);
  const range = monthRange(args.year, args.month);
  const scope = args.campaign ? { campaignIds: [campaignId] } : {};

  const bodies: Record<TReportKey, { path: string; body: Record<string, unknown> }> = {
    services: {
      path: unitedMarketplaceServicesGeneratePath(),
      body: { businessId, ...range, ...scope },
    },
    netting: { path: unitedNettingGeneratePath(), body: { businessId, ...range, ...scope } },
    orders: { path: unitedOrdersGeneratePath(), body: { businessId, ...range, ...scope } },
    returns: { path: unitedReturnsGeneratePath(), body: { businessId, ...range, ...scope } },
    // Реализация — по магазину и месяцу, кабинетного варианта нет.
    realization: {
      path: goodsRealizationGeneratePath(),
      body: { campaignId, year: args.year, month: args.month },
    },
  };

  console.log(RULE);
  console.log(`  МАГАЗИН:  ${store.name ?? '(без названия)'}`);
  console.log(`  ПЕРИОД:   ${range.dateFrom} … ${range.dateTo}`);
  console.log(`  ОХВАТ:    ${args.campaign ? 'активный магазин' : 'весь кабинет'}`);
  console.log(RULE);

  const summaries: ISheetSummary[] = [];
  const collected: TCollected = new Map();
  const keys = args.only ? [args.only] : REPORT_KEYS;

  for (const [index, report] of keys.entries()) {
    if (index > 0) await sleep(PAUSE_MS);
    console.log();
    console.log(RULE);
    console.log(`  ОТЧЁТ ${report}: ${bodies[report].path}`);
    console.log(`  тело: ${JSON.stringify(bodies[report].body)}`);
    console.log(RULE);

    try {
      const started = Date.now();
      const reportId = await client.generateReport(
        bodies[report].path,
        bodies[report].body,
        'JSON',
      );
      const fileUrl = await pollReportFile(client, reportId, {
        intervalMs: 5000,
        maxAttempts: 120, // 10 минут: финансовые отчёты за месяц собираются долго
        failedError: `Маркет не сформировал отчёт ${report} (FAILED, reportId ${reportId})`,
        notReadyError: `Отчёт ${report} не готов за 10 минут (reportId ${reportId})`,
      });
      console.log(
        `  reportId ${reportId}, готов за ${Math.round((Date.now() - started) / 1000)} с`,
      );
      if (!fileUrl) {
        console.log('  DONE без файла — данных за период нет');
        continue;
      }

      const buffer = await client.downloadReportFile(fileUrl);
      const sheets = unzipReportJson(buffer);
      console.log(
        `  архив ${buffer.length} байт, листов ${sheets.size}: ${[...sheets.keys()].join(', ')}`,
      );

      if (args.dump) {
        const dir = join(args.dump, report);
        mkdirSync(dir, { recursive: true });
        for (const [sheet, data] of sheets) {
          writeFileSync(join(dir, `${sheet}.json`), JSON.stringify(data, null, 1));
        }
        console.log(`  листы сохранены в ${dir}`);
      }

      collected.set(report, sheets);
      for (const [sheet, data] of sheets) summaries.push(analyseSheet(report, sheet, data));
    } catch (error) {
      // Один отчёт не роняет остальные: 420 по квоте или 400 по телу — это
      // ответ про этот отчёт, а не про разведку целиком.
      console.log(`  ✗ ${(error as Error).message}`);
    }
  }

  // Сверка: выплаты (netting) против начислений/удержаний услуг (services).
  // Числа печатаются по каждой денежной колонке — какая из них «итог», видно
  // только глазами на живом отчёте, угадывать её в коде значит подогнать.
  console.log();
  console.log(RULE);
  console.log('  СВОДКА Σ ПО ДЕНЕЖНЫМ КОЛОНКАМ');
  console.log(RULE);
  for (const s of summaries) {
    for (const [column, sum] of Object.entries(s.money)) {
      console.log(`  ${`${s.report}/${s.sheet}`.padEnd(40)} ${column.padEnd(32)} ${fmtMoney(sum)}`);
    }
  }

  reconcile(collected);
  checkJournalKeys(collected, args.compare);
  classifyJournal(collected);
  actBreakdown(collected);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
