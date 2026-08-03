import 'dotenv/config';
import { readFileSync } from 'node:fs';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { YandexMarketService } from '../src/database/services/yandex-market.service';
import { PurchasePriceService } from '../src/database/services/purchase-price.service';
import { StockSyncService } from '../src/modules/yandex/stocks/stock-sync.service';
import { YandexModule } from '../src/modules/yandex/yandex.module';

/**
 * Загрузка ЗАКУПОЧНЫХ ЦЕН из прайса — минуя Telegram.
 *
 * Зачем скрипт, когда есть бот. Прайс продавцу присылает поставщик, и обновить
 * закуп иногда нужно нам самим: например, после правки правил скидок или когда
 * в отчёте видно, что цен не хватает по десяткам артикулов. Гонять для этого
 * файл через Telegram — лишний круг.
 *
 * Идёт тем же `StockSyncService.sync` с `dryRun: true`, а не своим разбором
 * файла. Это принципиально:
 *
 *  - `dryRun` НЕ пишет остатки в Partner API — режим «проверка» обещает не менять
 *    ничего в магазине и обещание держит; каталог только читается;
 *  - закуп при этом пишется в НАШУ базу (см. комментарий в stock-sync.service),
 *    то есть ровно то, что здесь и нужно;
 *  - разбор прайса, разрешение артикулов по каталогу и правила скидок остаются
 *    в одном месте. Свой парсер разошёлся бы с ботом молча.
 *
 * Запись НЕ УДАЛЯЕТ строки, которых нет в файле: прайс может покрывать один
 * бренд, и «обновить» им всю базу значило бы потерять остальные цены.
 *
 * Запуск:
 *   npx ts-node scripts/load-purchase-prices.ts --user=<telegramUserId> --file=stock.xlsx
 */

// ErrorsModule импортируется ЯВНО, хотя он @Global(): глобальность делает
// провайдеры видимыми из уже загруженного модуля, но сам модуль в контекст не
// втягивает — без него сборка падает на ErrorReporter внутри ProfitService.
@Module({ imports: [AppConfigModule, ErrorsModule, YandexModule] })
class PricesModule {}

function parseArgs(argv: string[]): { user: string; file: string } {
  const user = argv.find((a) => a.startsWith('--user='))?.split('=')[1];
  const file = argv.find((a) => a.startsWith('--file='))?.split('=')[1];

  if (!user) throw new Error('Нужен --user=<telegramUserId>');
  if (!file) throw new Error('Нужен --file=<путь к прайсу .xlsx>');

  return { user, file };
}

async function main(): Promise<void> {
  const { user, file } = parseArgs(process.argv.slice(2));
  const buffer = readFileSync(file);

  const context = await NestFactory.createApplicationContext(PricesModule, { logger: ['error'] });

  try {
    const store = await context.get(YandexMarketService).findByTelegramUser(user);
    if (!store) throw new Error(`Магазин пользователя ${user} не найден.`);

    const prices = context.get(PurchasePriceService);
    const before = await prices.countForUser(user);

    console.log('─'.repeat(64));
    console.log(`  ФАЙЛ:     ${file} (${Math.round(buffer.length / 1024)} КБ)`);
    console.log(`  МАГАЗИН:  ${store.name ?? '(без названия)'}`);
    console.log(`  БАЗА:     ${process.env.MONGODB_DATABASE}`);
    console.log(`  ЦЕН ДО:   ${before}`);
    console.log('─'.repeat(64));

    // dryRun: остатки в Яндекс НЕ пишутся, закуп в нашу базу — пишется.
    const result = await context.get(StockSyncService).sync(
      {
        token: store.token,
        campaignId: store.campaign_id,
        businessId: store.business_id,
      },
      buffer,
      { telegramUserId: user, dryRun: true },
    );

    const after = await prices.countForUser(user);

    console.log(`Строк в прайсе:        ${result.totalRows}`);
    console.log(`Нашлись в каталоге:    ${result.matched} (каталог: ${result.catalogSize})`);
    console.log(`Закупочных цен записано: ${result.purchasePricesSaved}`);
    console.log(`Цен в базе стало:      ${after} (было ${before})`);
    console.log(`Пропущено строк:       ${result.skipped.length}`);

    // Способ сопоставления показывает, насколько прайс совпадает с каталогом:
    // перекос в сторону нестрогих правил — повод посмотреть на наименования.
    for (const [how, count] of Object.entries(result.matchedBy)) {
      console.log(`   сопоставлено «${how}»: ${count}`);
    }

    console.log('\nОстатки в Яндекс НЕ записывались — только закупочные цены в нашу базу.');
  } finally {
    await context.close();
  }
}

main().catch((error: Error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
