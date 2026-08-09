import 'dotenv/config';
import mongoose from 'mongoose';

import { YandexMarketSchema } from '../src/database/schemas/yandex-market.schema';
import { YandexApiClient } from '../src/modules/yandex/yandex-api.client';
import { subsidiesTotal, orderTotals } from '../src/modules/yandex/reports/money';
import {
  calendarDateParam,
  calendarDayBounds,
  moscowDay,
  shiftDays,
  type ICalendarDate,
} from '../src/modules/yandex/reports/moscow-day';
import { parseDayInput } from '../src/modules/yandex/reports/report-period';
import {
  statsOrderToReportOrder,
  toStatsStatuses,
} from '../src/modules/yandex/reports/stats-orders';
import type { IReportOrder } from '../src/modules/yandex/reports/order-reports.service';
import { ORDER_STATUS } from '../src/modules/yandex/reports/report-status-map';

/**
 * Сверка архивного метода (POST stats/orders) с getOrders — УСЛОВИЕ ВКЛЮЧЕНИЯ
 * фичи deep_history.
 *
 * Один и тот же период (по умолчанию последние 30 дней — оба метода его
 * покрывают) прогоняется через оба пути, и суммы обязаны сойтись ДО РУБЛЯ:
 * счёт заказов по статусам, Σ itemsTotal, Σ deliveryTotal, Σ субсидий по
 * типам. Расхождение печатается с id заказов. Пока числа не сошлись, флаг не
 * открывается никому — прецедент июльской сверки прибыли.
 *
 * Дополнительно печатается: доля PARTIALLY_DELIVERED (маппер зачитывает их в
 * PARTIALLY_RETURNED — деньги вниз, не вверх), незнакомые статусы архива,
 * включительность граничного дня и проба 60-дневного интервала одним запросом.
 *
 * Скрипт ТОЛЬКО ЧИТАЕТ. Запуск:
 *   npx ts-node scripts/diagnose-deep-history.ts --user=<telegramUserId>
 *   npx ts-node scripts/diagnose-deep-history.ts --user=<id> --from=01-07-2026 --to=30-07-2026
 */

const DEFAULT_BASE_URL = 'https://api.partner.market.yandex.ru';

function parseArgs(argv: string[], now: Date): { user: string; from: ICalendarDate; to: ICalendarDate } {
  const user = argv.find((a) => a.startsWith('--user='))?.split('=')[1];
  if (!user) throw new Error('Нужен --user=<telegramUserId>.');

  const fromArg = argv.find((a) => a.startsWith('--from='))?.split('=')[1];
  const toArg = argv.find((a) => a.startsWith('--to='))?.split('=')[1];

  const to = toArg ? parseDayInput(toArg) : moscowDay(now);
  const from = fromArg ? parseDayInput(fromArg) : shiftDays(moscowDay(now), -29);
  if (!from || !to) throw new Error('Не разобрал --from/--to. Формат: ДД-ММ-ГГГГ.');

  return { user, from, to };
}

interface ISetSummary {
  count: number;
  items: number;
  delivery: number;
  bySubsidyType: Map<string, number>;
  byStatus: Map<string, number>;
  ids: Set<number>;
}

function summarize(orders: readonly IReportOrder[]): ISetSummary {
  const byStatus = new Map<string, number>();
  const bySubsidyType = new Map<string, number>();
  const ids = new Set<number>();
  let items = 0;
  let delivery = 0;

  for (const order of orders) {
    byStatus.set(order.status ?? '?', (byStatus.get(order.status ?? '?') ?? 0) + 1);
    const totals = orderTotals(order);
    items += totals.items;
    delivery += totals.withDelivery - totals.items;
    if (order.id != null) ids.add(order.id);
    for (const subsidy of order.subsidies ?? []) {
      bySubsidyType.set(
        subsidy.type ?? '?',
        (bySubsidyType.get(subsidy.type ?? '?') ?? 0) + (Number(subsidy.amount) || 0),
      );
    }
  }

  return { count: orders.length, items, delivery, bySubsidyType, byStatus, ids };
}

function printSummary(title: string, summary: ISetSummary): void {
  console.log(`${title}: ${summary.count} заказов`);
  console.log(`   товары:   ${rub(summary.items)}`);
  console.log(`   доставка: ${rub(summary.delivery)}`);
  for (const [type, amount] of summary.bySubsidyType) {
    console.log(`   субсидии ${type}: ${rub(amount)}`);
  }
  for (const [status, count] of [...summary.byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${status.padEnd(22)} ${String(count).padStart(5)} шт.`);
  }
  console.log();
}

function rub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function diffIds(a: Set<number>, b: Set<number>): number[] {
  return [...a].filter((id) => !b.has(id)).slice(0, 20);
}

async function collectGetOrders(
  client: YandexApiClient,
  from: ICalendarDate,
  to: ICalendarDate,
  statuses: string[],
  filter: 'creation' | 'update',
  now: Date,
): Promise<IReportOrder[]> {
  const query =
    filter === 'creation'
      ? {
          fromDate: calendarDateParam(from),
          // Верхняя граница getOrders исключающая — сдвиг на день, как в
          // creationDateParams.
          toDate: calendarDateParam(shiftDays(to, 1)),
          status: statuses,
        }
      : {
          updatedAtFrom: calendarDayBounds(from, now).from,
          updatedAtTo: calendarDayBounds(to, now).to,
          status: statuses,
        };

  const out: IReportOrder[] = [];
  for await (const page of client.iterateOrders(query)) out.push(...(page as IReportOrder[]));
  return out;
}

async function collectStats(
  client: YandexApiClient,
  from: ICalendarDate,
  to: ICalendarDate,
  statuses: string[],
  filter: 'creation' | 'update',
): Promise<IReportOrder[]> {
  const range =
    filter === 'creation'
      ? { dateFrom: iso(from), dateTo: iso(to) }
      : { updateFrom: iso(from), updateTo: iso(to) };

  const out: IReportOrder[] = [];
  for await (const page of client.iterateOrdersStats({ ...range, statuses })) {
    out.push(...page.map(statsOrderToReportOrder));
  }
  return out;
}

function iso(date: ICalendarDate): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

async function compareSet(
  client: YandexApiClient,
  title: string,
  from: ICalendarDate,
  to: ICalendarDate,
  orderStatuses: string[],
  filter: 'creation' | 'update',
  now: Date,
): Promise<void> {
  console.log('═'.repeat(72));
  console.log(`  ${title}`);
  console.log('═'.repeat(72));

  const [viaGet, viaStats] = [
    await collectGetOrders(client, from, to, orderStatuses, filter, now),
    await collectStats(
      client,
      from,
      to,
      toStatsStatuses(orderStatuses as never),
      filter,
    ),
  ];

  const a = summarize(viaGet);
  const b = summarize(viaStats);
  printSummary('getOrders  ', a);
  printSummary('statsOrders', b);

  const missingInStats = diffIds(a.ids, b.ids);
  const extraInStats = diffIds(b.ids, a.ids);
  if (missingInStats.length) console.log(`⚠️ Нет в архиве (${missingInStats.length}+): ${missingInStats.join(', ')}`);
  if (extraInStats.length) console.log(`⚠️ Только в архиве (${extraInStats.length}+): ${extraInStats.join(', ')}`);

  const moneyMatch =
    Math.round(a.items) === Math.round(b.items) && Math.round(a.delivery) === Math.round(b.delivery);
  console.log(
    moneyMatch && !missingInStats.length && !extraInStats.length
      ? '✅ СОШЛОСЬ: составы и деньги совпадают до рубля.'
      : '❌ РАСХОЖДЕНИЕ: см. цифры выше. Флаг deep_history включать НЕЛЬЗЯ.',
  );
  console.log();
}

async function main(): Promise<void> {
  const now = new Date();
  const { user, from, to } = parseArgs(process.argv.slice(2), now);

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
  await mongoose.disconnect();

  if (!store?.token) throw new Error(`Магазин пользователя ${user} не найден или без токена.`);

  const client = new YandexApiClient(
    { token: store.token, campaignId: store.campaign_id, businessId: store.business_id },
    process.env.YANDEX_MARKET_BASE_URL ?? DEFAULT_BASE_URL,
  );

  console.log('─'.repeat(72));
  console.log(`  ПЕРИОД:  ${calendarDateParam(from)} — ${calendarDateParam(to)} (МСК)`);
  console.log(`  МАГАЗИН: ${store.name ?? '(без названия)'}`);
  console.log('─'.repeat(72));
  console.log();

  // Набор «Выкуплено»/«Прибыль»: DELIVERED по дате обновления.
  await compareSet(
    client,
    'ВЫКУПЛЕННЫЕ (DELIVERED, по updatedAt / updateFrom)',
    from,
    to,
    [ORDER_STATUS.DELIVERED],
    'update',
    now,
  );

  // Набор «Оформлено»/«Калькулятор»: по дате создания. Статусы — только
  // разрешённые обоим методам в фильтре.
  await compareSet(
    client,
    'ОФОРМЛЕННЫЕ (по creationDate / dateFrom)',
    from,
    to,
    [
      ORDER_STATUS.UNPAID,
      ORDER_STATUS.PROCESSING,
      ORDER_STATUS.DELIVERY,
      ORDER_STATUS.PICKUP,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.RETURNED,
    ],
    'creation',
    now,
  );

  // Граничный день: заказы, созданные в САМ день `to`, обязаны попасть в
  // архивную выборку (обе границы у stats включительны по спеке).
  console.log('═'.repeat(72));
  console.log('  ГРАНИЧНЫЙ ДЕНЬ + ДЛИННЫЙ ИНТЕРВАЛ');
  console.log('═'.repeat(72));
  const edge = await collectStats(client, to, to, [], 'creation');
  console.log(`Создано в ${calendarDateParam(to)} по версии архива: ${edge.length} заказов`);

  // Проба 60-дневного интервала ОДНИМ запросом: если пройдёт — окна можно
  // будет удлинить (сейчас архив режется теми же 30-дневными окнами).
  try {
    const long = await collectStats(client, shiftDays(to, -59), to, [], 'creation');
    console.log(`60-дневный интервал одним запросом: ОК, ${long.length} заказов.`);
  } catch (error) {
    console.log(
      `60-дневный интервал одним запросом: ОТКАЗ (${error instanceof Error ? error.message : error}).`,
    );
  }

  // Доля PARTIALLY_DELIVERED — маппер зачитывает их в PARTIALLY_RETURNED.
  const partial = await collectStats(client, from, to, ['PARTIALLY_DELIVERED'], 'update');
  console.log(`PARTIALLY_DELIVERED за период: ${partial.length} заказов на ${rub(
    partial.reduce((sum, order) => sum + orderTotals(order).items, 0),
  )} (subsidies ${rub(partial.reduce((sum, order) => sum + subsidiesTotal(order), 0))})`);
}

main().catch((error: Error) => {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
});
