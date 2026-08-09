import 'dotenv/config';
import mongoose from 'mongoose';

import { YandexMarketSchema } from '../src/database/schemas/yandex-market.schema';
import { YandexApiClient, type IReturnRecord } from '../src/modules/yandex/yandex-api.client';
import {
  RETURN_ACTIVE_STATUSES,
  RETURN_DEAD_REFUND_STATUSES,
  RETURN_SHIPMENT_STATUSES,
  returnStage,
} from '../src/modules/yandex/reports/report-status-map';

/**
 * Сверка «Едет обратно» с кабинетом продавца.
 *
 * Зачем. Число возвратов расходилось с кабинетом трижды, и каждый раз молча:
 * сперва спрашивали одну стадию из пяти (38 против 50), потом отбрасывали
 * CREATED целиком вместо отменённых заявок (65 против 68). Ошибка тут не даёт
 * ни исключения, ни падения теста — отчёт просто показывает не то число, и
 * узнаём мы об этом от продавца. Скрипт сводит разницу к одной команде.
 *
 * Скрипт ТОЛЬКО ЧИТАЕТ: Mongo — findOne, Partner API — GET.
 *
 * Запуск:
 *   npx ts-node scripts/diagnose-returns.ts --user=<telegramUserId>
 *   npx ts-node scripts/diagnose-returns.ts --user=<id> --list
 *
 * `--list` печатает построчно CREATED и записи без `shipmentStatus` — те две
 * группы, из-за которых расхождение и возникает.
 *
 * Обход идёт БЕЗ фильтра `shipmentStatuses` намеренно: смысл как раз в том,
 * чтобы увидеть отброшенное. Это двадцать с лишним страниц против одной у
 * бота — на квоту метода (10 000/час) несущественно.
 */

const DEFAULT_BASE_URL = 'https://api.partner.market.yandex.ru';

/** Ширина разделителей — как в diagnose-orders.ts. */
const RULE = '─'.repeat(72);

function parseUser(argv: string[]): string {
  const user = argv.find((a) => a.startsWith('--user='))?.split('=')[1];
  if (!user) {
    throw new Error('Нужен --user=<telegramUserId>. Он же в админ-карточке пользователя.');
  }
  return user;
}

/** Сколько записей и сколько РАЗНЫХ заказов: кабинет считает заказами. */
function tally(records: IReturnRecord[]): { records: number; orders: number } {
  return {
    records: records.length,
    orders: new Set(records.map((r) => r.orderId)).size,
  };
}

function printTally(title: string, records: IReturnRecord[]): void {
  const { records: n, orders } = tally(records);
  console.log(`  ${title.padEnd(46)} записей ${String(n).padStart(5)}   заказов ${orders}`);
}

function counted(records: IReturnRecord[], stages: readonly string[]): IReturnRecord[] {
  return records.filter((r) => {
    if (!stages.includes(r.shipmentStatus)) return false;
    return returnStage(r.shipmentStatus, r.refundStatus) !== 'dead';
  });
}

function line(record: IReturnRecord): string {
  return [
    String(record.returnId ?? '?').padEnd(10),
    `заказ ${record.orderId ?? '?'}`.padEnd(20),
    ((record.raw as { returnType?: string })?.returnType ?? '?').padEnd(11),
    (record.refundStatus ?? '(нет)').padEnd(30),
    `оформлен ${(record.creationDate ?? '').slice(0, 10) || '(нет даты)'}`,
    `— ${returnStage(record.shipmentStatus, record.refundStatus)}`,
  ].join(' ');
}

async function main(): Promise<void> {
  const user = parseUser(process.argv.slice(2));

  const url = process.env.MONGODB_URL;
  const dbName = process.env.MONGODB_DATABASE;
  if (!url || !dbName) throw new Error('Нужны MONGODB_URL и MONGODB_DATABASE в .env');

  await mongoose.connect(url, { dbName });
  const Store = mongoose.model('YandexMarket', YandexMarketSchema);
  const store = await Store.findOne({ telegramUserId: user }).lean<{
    token?: string;
    campaign_id?: string;
    business_id?: string;
    name?: string;
  }>();

  if (!store?.token) {
    await mongoose.disconnect();
    throw new Error(`Магазин пользователя ${user} не найден или без токена.`);
  }

  const client = new YandexApiClient(
    { token: store.token, campaignId: store.campaign_id, businessId: store.business_id },
    process.env.YANDEX_MARKET_BASE_URL ?? DEFAULT_BASE_URL,
  );

  console.log(RULE);
  console.log(`  МАГАЗИН:  ${store.name ?? '(без названия)'} (кампания ${store.campaign_id})`);
  console.log(RULE);
  console.log();

  const all: IReturnRecord[] = [];
  let pages = 0;
  for await (const page of client.iterateReturns()) {
    pages += 1;
    all.push(...page);
  }
  console.log(`Возвратов всего: ${all.length} (страниц: ${pages})`);
  console.log();

  // 1. Раскладка по стадии отгрузки. Она отвечает на вопрос «что вообще есть»
  // до того, как какой-либо фильтр что-то отбросил.
  const byShipment = new Map<string, number>();
  for (const r of all) {
    const key = r.shipmentStatus ?? '(нет shipmentStatus)';
    byShipment.set(key, (byShipment.get(key) ?? 0) + 1);
  }
  console.log('ПО СТАДИИ ОТГРУЗКИ:');
  for (const [key, n] of [...byShipment].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(24)} ${String(n).padStart(5)}`);
  }
  console.log();

  // 2. Статус возврата ДЕНЕГ — второе поле правила. Мёртвые заявки видны здесь.
  const byRefund = new Map<string, number>();
  for (const r of all) {
    const key = r.refundStatus ?? '(нет refundStatus)';
    byRefund.set(key, (byRefund.get(key) ?? 0) + 1);
  }
  console.log('ПО СТАТУСУ ВОЗВРАТА ДЕНЕГ:');
  for (const [key, n] of [...byRefund].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(34)} ${String(n).padStart(5)}`);
  }
  console.log();

  // 3. Кандидаты на число из кабинета. Печатаются рядом: разница между строками
  // и есть ответ на «почему у бота другое», причём без второго запуска.
  const activeStages: readonly string[] = RETURN_ACTIVE_STATUSES;
  const legacy = all.filter((r) =>
    ['RECEIVED', 'IN_TRANSIT', 'READY_FOR_PICKUP'].includes(r.shipmentStatus),
  );
  const active = counted(all, activeStages);
  const withDead = all.filter((r) => activeStages.includes(r.shipmentStatus));
  const period = counted(all, RETURN_SHIPMENT_STATUSES);

  console.log('СКОЛЬКО «ЕДЕТ ОБРАТНО» — сверяйте с кабинетом:');
  printTally('старое правило (три транзитные стадии)', legacy);
  printTally('текущее правило («Всего»)', active);
  printTally('   оно же, если НЕ отсекать мёртвые заявки', withDead);
  printTally('за период (все стадии, без мёртвых)', period);
  console.log();
  console.log(`  Бот печатает число ЗАКАЗОВ текущего правила: ${tally(active).orders}`);
  console.log(`  Мёртвыми считаются заявки CREATED со статусом денег:`);
  console.log(`     ${RETURN_DEAD_REFUND_STATUSES.join(', ')}`);
  console.log();

  // 4. Две группы, из-за которых расхождение и возникает. Без статуса отгрузки
  // записи до отчёта не доезжают вовсе: фильтр запроса их не вернёт.
  const created = all.filter((r) => r.shipmentStatus === 'CREATED');
  const noStatus = all.filter((r) => !r.shipmentStatus);
  console.log(`Заявок CREATED: ${created.length}   Без shipmentStatus: ${noStatus.length}`);

  if (process.argv.includes('--list')) {
    console.log();
    console.log('CREATED:');
    for (const r of created) console.log(`  ${line(r)}`);
    console.log();
    console.log('БЕЗ shipmentStatus (в отчёт не попадают — фильтр запроса их не вернёт):');
    for (const r of noStatus) console.log(`  ${line(r)}`);
  } else {
    console.log('(построчно — с ключом --list)');
  }

  console.log();
  console.log(RULE);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
