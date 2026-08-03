import 'dotenv/config';
import mongoose from 'mongoose';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { ErrorsModule } from '../src/modules/errors/errors.module';

import { PurchasePriceSchema } from '../src/database/schemas/purchase-price.schema';
import { YandexMarketSchema } from '../src/database/schemas/yandex-market.schema';
import { YandexMarketService } from '../src/database/services/yandex-market.service';
import { YandexApiClient } from '../src/modules/yandex/yandex-api.client';
import { YandexModule } from '../src/modules/yandex/yandex.module';
import { orderTotals } from '../src/modules/yandex/reports/money';
import { formatProfitReport } from '../src/modules/yandex/reports/profit-message';
import { ProfitService } from '../src/modules/yandex/reports/profit.service';
import type { IReportPeriod } from '../src/modules/yandex/reports/report-period';
import {
  calendarDateParam,
  calendarDayBounds,
  moscowDay,
  shiftDays,
  startOfMonth,
  type ICalendarDate,
} from '../src/modules/yandex/reports/moscow-day';
import { QUERYABLE_STATUSES } from '../src/modules/yandex/reports/report-status-map';
import { parseDayInput } from '../src/modules/yandex/reports/report-period';

/**
 * Разбивка заказов за день: что бот ВИДИТ и что продавец СЧИТАЕТ.
 *
 * Зачем. Продавец сказал «за сегодня было ровно 40», а отчёт о прибыли показал
 * 9 заказов. Обе цифры верны, но считают разное: прибыль берёт выкупленные
 * (`status=DELIVERED` по `updatedAt`), а продавец смотрит на оформленные. Пока
 * это не подтверждено боевыми числами, любой список статусов для нового блока
 * «Оформлено» — угадывание.
 *
 * Скрипт ТОЛЬКО ЧИТАЕТ: Mongo — findOne, Partner API — GET. Ни одного PUT/POST,
 * меняющего данные (единственная запись в проекте — остатки, её здесь нет).
 *
 * Запуск:
 *   npx ts-node scripts/diagnose-orders.ts --user=<telegramUserId>
 *   npx ts-node scripts/diagnose-orders.ts --user=<id> --date=30-07-2026
 *   npx ts-node scripts/diagnose-orders.ts --user=<id> --report
 *   npx ts-node scripts/diagnose-orders.ts --user=<id> --unknown
 *
 * `--unknown` печатает ПОЛНЫЙ список артикулов без закупочной цены за месяц: в
 * сообщение бота их влезает пять, а дозаполнять прайс нужно по всем.
 *
 * `--report` собирает НАСТОЯЩИЙ отчёт о прибыли теми же сервисами, что и бот, и
 * печатает его текст. Поднимается только YandexModule: AppModule запустил бы
 * BotRegistry, а тот на старте переставляет вебхуки — то есть диагностика
 * отобрала бы обновления у работающего бота.
 */

const DEFAULT_BASE_URL = 'https://api.partner.market.yandex.ru';

/** Глубина гистограммы «заказы по дням». Меньше 30 — окна истории хватает. */
const HISTOGRAM_DAYS = 7;

interface IArgs {
  user: string;
  day: ICalendarDate;
}

/** Заказ в объёме, нужном разбивке. */
interface IRawOrder {
  id?: number;
  status?: string;
  substatus?: string;
  creationDate?: string;
  itemsTotal?: number;
  // offerName нужен списку недостающих артикулов: один код без наименования в
  // прайсе не найти.
  items?: Array<{ count?: number; offerId?: string; offerName?: string }>;
}

function parseArgs(argv: string[], now: Date): IArgs {
  const user = argv.find((a) => a.startsWith('--user='))?.split('=')[1];
  if (!user) {
    throw new Error('Нужен --user=<telegramUserId>. Он же в админ-карточке пользователя.');
  }

  const dateArg = argv.find((a) => a.startsWith('--date='))?.split('=')[1];
  if (!dateArg) return { user, day: moscowDay(now) };

  // Разбор через parseDayInput — тот же, которым бот принимает дату от продавца:
  // «30-07-2026» и «30.07.2026» здесь обязаны значить ровно то же самое.
  const day = parseDayInput(dateArg);
  if (!day) throw new Error(`Не разобрал дату «${dateArg}». Формат: ДД-ММ-ГГГГ.`);

  return { user, day };
}

/** Свод по одному набору заказов: сколько штук и на сколько — в разрезе статуса. */
function breakdown(orders: IRawOrder[]): Map<string, { count: number; items: number }> {
  const rows = new Map<string, { count: number; items: number }>();

  for (const order of orders) {
    const key = order.substatus ? `${order.status} / ${order.substatus}` : `${order.status}`;
    const row = rows.get(key) ?? { count: 0, items: 0 };
    row.count += 1;
    row.items += orderTotals(order).items;
    rows.set(key, row);
  }

  return rows;
}

function printBreakdown(title: string, orders: IRawOrder[]): void {
  const rows = [...breakdown(orders).entries()].sort((a, b) => b[1].count - a[1].count);
  const total = orders.reduce((sum, order) => sum + orderTotals(order).items, 0);

  console.log(
    `${title}: ${orders.length} заказов на ${Math.round(total).toLocaleString('ru-RU')} ₽`,
  );
  for (const [status, row] of rows) {
    console.log(
      `   ${status.padEnd(42)} ${String(row.count).padStart(4)} шт.  ` +
        `${Math.round(row.items).toLocaleString('ru-RU').padStart(12)} ₽`,
    );
  }
  console.log();
}

async function collect(
  client: YandexApiClient,
  query: Parameters<YandexApiClient['getOrders']>[0],
): Promise<IRawOrder[]> {
  const orders: IRawOrder[] = [];
  let pages = 0;

  for await (const page of client.iterateOrders(query)) {
    pages += 1;
    orders.push(...(page as IRawOrder[]));
  }

  console.log(`   (страниц: ${pages})`);
  return orders;
}

/**
 * Обёртка для `--report`.
 *
 * `AppConfigModule` импортируется ЯВНО, хотя он `@Global()`: глобальность
 * действует внутри уже собранного графа, а не подтягивает модуль в контекст.
 * Без него `MongooseModule.forRootAsync` не находит `AppConfigService` и
 * контекст падает на этапе разрешения зависимостей.
 *
 * Здесь только Yandex: `AppModule` поднял бы `BotRegistry`, а тот на старте
 * переставляет вебхуки — диагностика отобрала бы обновления у живого бота.
 */
// ErrorsModule импортируется ЯВНО, хотя он @Global(): глобальность делает
// провайдеры видимыми из уже загруженного модуля, но сам модуль в контекст не
// втягивает — без него сборка падает на ErrorReporter внутри ProfitService.
@Module({ imports: [AppConfigModule, ErrorsModule, YandexModule] })
class DiagnosticsModule {}

/**
 * Настоящий отчёт о прибыли — теми же сервисами, что зовёт кнопка бота.
 *
 * Отдельный контекст Nest со своим подключением к Mongo: гонять расчёт мимо
 * ProfitService значило бы проверять не тот код, который поедет в прод.
 */
async function printReport(user: string, period: IReportPeriod, now: Date): Promise<void> {
  const context = await NestFactory.createApplicationContext(DiagnosticsModule, { logger: false });

  try {
    const stores = context.get(YandexMarketService);
    const store = await stores.findByTelegramUser(user);
    if (!store) throw new Error(`Магазин пользователя ${user} не найден.`);

    const report = await context.get(ProfitService).build(store, period, now);

    console.log('ОТЧЁТ, КАК ЕГО УВИДИТ ПРОДАВЕЦ:');
    console.log('─'.repeat(72));
    // Разметку Telegram убираем — в терминале теги только мешают читать.
    console.log(formatProfitReport(report, now).replace(/<\/?(?:b|i|code)>/g, ''));
    console.log('─'.repeat(72));
  } finally {
    await context.close();
  }
}

/**
 * Полный список артикулов без закупочной цены за период.
 *
 * В отчёт их попадает только пять: сообщение Telegram ограничено, а сорок
 * артикулов подряд не читаются. Здесь же нужен весь список — с наименованием из
 * заказа и числом заказов, чтобы было понятно, что именно дозаполнить в прайсе и
 * что дороже всего игнорировать.
 */
async function printUnknownSkus(
  client: YandexApiClient,
  user: string,
  from: ICalendarDate,
  to: ICalendarDate,
  now: Date,
): Promise<void> {
  // Оба набора отчёта: заказ без закупа выпадает и из оформленных, и из выкупленных.
  const placed = await collect(client, {
    fromDate: calendarDateParam(from),
    toDate: calendarDateParam(shiftDays(to, 1)),
    status: [...QUERYABLE_STATUSES],
  });
  const redeemed = await collect(client, {
    updatedAtFrom: calendarDayBounds(from, now).from,
    updatedAtTo: calendarDayBounds(to, now).to,
    status: ['DELIVERED'],
  });

  // Отменённые не в счёт: их и отчёт не считает.
  const orders = [...placed, ...redeemed].filter((o) => o.status !== 'CANCELLED');

  /** Артикул → наименование и сколько раз встретился. */
  const seen = new Map<string, { name: string; orders: number; units: number }>();
  for (const order of orders) {
    for (const item of order.items ?? []) {
      const sku = item.offerId ?? '(без артикула)';
      const row = seen.get(sku) ?? { name: item.offerName ?? '', orders: 0, units: 0 };
      row.orders += 1;
      row.units += Number(item.count) || 1;
      if (!row.name && item.offerName) row.name = item.offerName;
      seen.set(sku, row);
    }
  }

  const Prices = mongoose.model('PurchasePrice', PurchasePriceSchema);
  const known = new Set(
    (
      await Prices.find({ telegramUserId: user, sku: { $in: [...seen.keys()] } })
        .select('sku')
        .lean<Array<{ sku: string }>>()
    ).map((doc) => doc.sku),
  );

  const unknown = [...seen.entries()]
    .filter(([sku]) => !known.has(sku))
    .sort((a, b) => b[1].units - a[1].units);

  console.log(
    `АРТИКУЛОВ БЕЗ ЗАКУПОЧНОЙ ЦЕНЫ: ${unknown.length} из ${seen.size} ` +
      `(${calendarDateParam(from)} — ${calendarDateParam(to)})`,
  );
  console.log('─'.repeat(72));
  for (const [sku, row] of unknown) {
    console.log(`${sku}\t${row.units} шт.\t${row.name}`);
  }
  console.log('─'.repeat(72));
  console.log(`Всего штук без закупа: ${unknown.reduce((n, [, row]) => n + row.units, 0)}`);
}

async function main(): Promise<void> {
  const now = new Date();
  const { user, day } = parseArgs(process.argv.slice(2), now);

  if (process.argv.includes('--report')) {
    const isToday = calendarDateParam(day) === calendarDateParam(moscowDay(now));
    await printReport(user, isToday ? { key: 'today' } : { key: 'day', day }, now);
    return;
  }

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

  // Список артикулов без закупа — за месяц, а не за день: продавцу нужен весь
  // недостающий прайс, а не то, что подвернулось сегодня.
  if (process.argv.includes('--unknown')) {
    await printUnknownSkus(client, user, startOfMonth(day), day, now);
    await mongoose.disconnect();
    return;
  }

  const date = calendarDateParam(day);
  console.log('─'.repeat(72));
  console.log(`  ДЕНЬ:     ${date} (МСК)`);
  console.log(`  МАГАЗИН:  ${store.name ?? '(без названия)'} `);
  console.log('─'.repeat(72));
  console.log();

  // 1. Сколько магазинов у токена. Отчёт всегда идёт по ОДНОЙ кампании, и если
  // их несколько, часть заказов продавца бот просто не видит.
  const stores = await client.listStores();
  console.log(`Магазинов у токена: ${stores.length}`);
  for (const s of stores) {
    const mark = s.campaignId === store.campaign_id ? ' ← опрашивается ботом' : '';
    console.log(`   ${s.storeName} (кампания ${s.campaignId})${mark}`);
  }
  console.log();

  // 2. Оформленные за день — БЕЗ фильтра по статусу, чтобы увидеть все статусы
  // сразу и понять, из каких складывается число, которое называет продавец.
  //
  // `toDate` сдвинут на день вперёд намеренно: по документации это «заказы,
  // созданные ДО 00:00 указанного дня», то есть граница исключающая.
  const placed = await collect(client, {
    fromDate: calendarDateParam(day),
    toDate: calendarDateParam(shiftDays(day, 1)),
  });
  printBreakdown('ОФОРМЛЕНО за день (все статусы)', placed);

  // 3. Ровно тот запрос, который делает отчёт о прибыли сегодня.
  const bounds = calendarDayBounds(day, now);
  const redeemed = await collect(client, {
    updatedAtFrom: bounds.from,
    updatedAtTo: bounds.to,
    status: ['DELIVERED'],
  });
  printBreakdown('ВЫКУПЛЕНО за день (status=DELIVERED по updatedAt)', redeemed);

  // 4. Пересечение: сколько из выкупленных сегодня было и оформлено сегодня.
  // Именно это число решает, можно ли писать «из них выкуплено» — или наборы
  // разные и складывать их нельзя.
  const placedIds = new Set(placed.map((o) => o.id));
  const overlap = redeemed.filter((o) => placedIds.has(o.id)).length;
  console.log(`Выкуплено сегодня из оформленных сегодня: ${overlap} из ${redeemed.length}`);
  console.log();

  // 5. Штуки товара, а не заказы. Продавец может считать позиции: в одном
  // заказе часов бывает несколько, и тогда «40» — это не количество заказов.
  const units = (orders: IRawOrder[]) =>
    orders.reduce(
      (sum, o) => sum + (o.items ?? []).reduce((n, item) => n + (Number(item.count) || 1), 0),
      0,
    );
  console.log(`Товаров (штук) в оформленных за день: ${units(placed)}`);
  console.log(`Товаров (штук) в выкупленных за день: ${units(redeemed)}`);
  console.log();

  // 6. Срез «что сейчас в работе» — без фильтра даты. Ещё один кандидат на
  // число, которое продавец видит в кабинете одной цифрой.
  const inWork = await collect(client, { status: ['PROCESSING', 'DELIVERY', 'PICKUP'] });
  printBreakdown('СЕЙЧАС В РАБОТЕ (без фильтра даты)', inWork);

  // 7. Заказы по дням за неделю. Дневная норма магазина показывает, мало ли
  // сегодняшнее число или это обычный день: одна цифра за один день сама по
  // себе не отвечает, недобор это или ещё не вечер.
  const week = await collect(client, {
    fromDate: calendarDateParam(shiftDays(day, -HISTOGRAM_DAYS + 1)),
    toDate: calendarDateParam(shiftDays(day, 1)),
  });

  const byDay = new Map<string, number>();
  for (const order of week) {
    // creationDate приходит как «ДД-ММ-ГГГГ ЧЧ:ММ:СС» — со временем, хотя фильтр
    // принимает только дату. Берём первые 10 символов, иначе каждый заказ
    // попадает в собственную «дату» и гистограмма выходит из нулей.
    const key = (order.creationDate ?? '(без даты)').slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }

  console.log(`ЗАКАЗЫ ПО ДНЯМ (${HISTOGRAM_DAYS} дней, по дате оформления):`);
  for (let i = HISTOGRAM_DAYS - 1; i >= 0; i -= 1) {
    const key = calendarDateParam(shiftDays(day, -i));
    const count = byDay.get(key) ?? 0;
    console.log(`   ${key}  ${String(count).padStart(4)} шт.  ${'█'.repeat(count)}`);
  }
  console.log();

  // 8. Сегодняшние заказы ВТОРЫМ путём — через фильтр по обновлению, без
  // фильтра по статусу. Совпадение с пунктом 2 означает, что фильтр по дате
  // оформления ничего не теряет; расхождение — что теряет, и тогда чинить надо
  // именно его, а не текст отчёта.
  const touched = (await collect(client, {
    updatedAtFrom: bounds.from,
    updatedAtTo: bounds.to,
  })) as IRawOrder[];

  const createdToday = touched.filter((o) => (o.creationDate ?? '').startsWith(date));
  console.log(`Заказов обновлено сегодня: ${touched.length}`);
  console.log(
    `Из них оформлено сегодня: ${createdToday.length} (по фильтру дат было ${placed.length})`,
  );

  await mongoose.disconnect();
}

main().catch(async (error: Error) => {
  console.error(`\n❌ ${error.message}`);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
