import 'dotenv/config';

import type { TStockLocation } from '../src/modules/marketplaces/marketplace-adapter';
import type { IMatchableProduct } from '../src/modules/products/product.domain';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { DatabaseModule } from '../src/database/database.module';
import { ProductCardIssueService } from '../src/database/services/product-card-issue.service';
import { ProductService } from '../src/database/services/product.service';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { MarketplaceRegistry } from '../src/modules/marketplaces/marketplace-registry.service';
import { MarketplacesModule } from '../src/modules/marketplaces/marketplaces.module';
import { ProductMatchService } from '../src/modules/products/product-match.service';
import { matchCards, summarizeMatches } from '../src/modules/products/product.domain';
import { ProductsModule } from '../src/modules/products/products.module';

/**
 * Каталог и остатки Ozon (TASK-129) или WB (TASK-134, `--marketplace=wb`) →
 * база товаров. Один скрипт на обе площадки: второй, почти одинаковый,
 * разошёлся бы с первым — отличаются только подписи мест хранения.
 *
 * Из площадки — ТОЛЬКО чтение (список карточек, их описание, остатки). Без
 * `--write` скрипт ничего не пишет и в нашу Mongo: считает сопоставление с
 * товарами в памяти и печатает, что произошло бы, — так процент и конфликты
 * штрихкодов видны до записи. С `--write` привязки и очередь «не сопоставлено»
 * пишутся тем же `ProductMatchService.syncCatalog`, что пишет каталог ЯМ.
 *
 * Площадка спрашивается через реестр площадок (TASK-163), как любой потребитель:
 * каталог и остатки приходят нашими сущностями. Реестр тянет модули всех
 * площадок, в том числе финансы, — поэтому скрипту нужен `POSTGRES_URL`, как
 * финансовым скриптам (Postgres только поднимается, данные не трогаются).
 *
 * Без AppModule: он поднял бы BotRegistry, а тот переставил бы вебхук.
 *
 * Запуск:
 *   npx ts-node scripts/sync-ozon-catalog.ts --user=<telegramUserId> [--marketplace=ozon|wb] [--write]
 */

// ErrorsModule — явно, хотя он @Global(): см. комментарий в load-purchase-prices.ts.
@Module({
  imports: [AppConfigModule, ErrorsModule, DatabaseModule, MarketplacesModule, ProductsModule],
})
class SyncModule {}

type TCatalogMarketplace = 'ozon' | 'wb';

/** Подписи площадки: у Ozon склад площадки — FBO, у WB — FBW. Места не складываются. */
const LABELS: Record<TCatalogMarketplace, { title: string; marketplace: string }> = {
  ozon: { title: 'Ozon', marketplace: 'FBO, склад Ozon:        ' },
  wb: { title: 'WB', marketplace: 'FBW, склад WB:          ' },
};

function parseArgs(argv: string[]): {
  user: string;
  marketplace: TCatalogMarketplace;
  write: boolean;
} {
  const user = argv.find((a) => a.startsWith('--user='))?.split('=')[1];
  if (!user) throw new Error('Нужен --user=<telegramUserId>');
  const marketplace = argv.find((a) => a.startsWith('--marketplace='))?.split('=')[1] ?? 'ozon';
  if (marketplace !== 'ozon' && marketplace !== 'wb') {
    throw new Error('--marketplace — ozon или wb');
  }
  return { user, marketplace, write: argv.includes('--write') };
}

/** Контрольная цифра GTIN (EAN-8/12/13/14). Штрихкоды продавца часто — внутренние номера. */
function isGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() ?? 0;
  const sum = digits.reverse().reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

async function main(): Promise<void> {
  const { user, marketplace, write } = parseArgs(process.argv.slice(2));
  const label = LABELS[marketplace];
  const context = await NestFactory.createApplicationContext(SyncModule, { logger: ['error'] });

  try {
    const registry = context.get(MarketplaceRegistry);
    const ref = { telegramUserId: user, marketplace };
    const [rows, stocks] = await Promise.all([
      registry.require(marketplace, 'catalog', user).listProducts(ref),
      registry.require(marketplace, 'stocks', user).listStocks(ref),
    ]);

    console.log('─'.repeat(64));
    console.log(`  ПРОДАВЕЦ: ${user}`);
    console.log(`  БАЗА:     ${process.env.MONGODB_DATABASE}`);
    console.log(`  РЕЖИМ:    ${write ? 'ЗАПИСЬ в Mongo' : 'только чтение (без --write)'}`);
    console.log('─'.repeat(64));

    const barcodes = rows.flatMap((row) => row.barcodes);
    const notGtin = barcodes.filter((code) => !isGtin(code)).length;
    console.log(
      `Карточек ${label.title}:${' '.repeat(18 - label.title.length)}${rows.length} (архивных ${rows.filter((r) => r.archived).length})`,
    );
    console.log(`  строк для товаров:       ${rows.length}`);
    console.log(`  со штрихкодом:           ${rows.filter((r) => r.barcodes.length).length}`);
    console.log(
      `  штрихкодов не GTIN:      ${notGtin} из ${barcodes.length}` +
        (barcodes.length ? ` (${Math.round((notGtin / barcodes.length) * 100)}%)` : ''),
    );

    // «Лежит» = доступно + резерв: так Ozon считает `present`; у WB резерва нет (null).
    // Места не складываются.
    const totalOf = (location: TStockLocation) =>
      Object.values(stocks.byLocation[location] ?? {}).reduce(
        (acc, amount) => ({
          present: acc.present + amount.available + (amount.reserved ?? 0),
          reserved: acc.reserved + (amount.reserved ?? 0),
        }),
        { present: 0, reserved: 0 },
      );
    const fbo = totalOf('marketplace');
    const fbs = totalOf('seller');
    const skuCount = new Set(
      Object.values(stocks.byLocation).flatMap((amounts) => Object.keys(amounts ?? {})),
    ).size;
    console.log(`Остатки (${skuCount} артикулов), раздельно:`);
    console.log(`  ${label.marketplace}${fbo.present} шт., из них в резерве ${fbo.reserved}`);
    console.log(`  FBS, склад продавца:     ${fbs.present} шт., из них в резерве ${fbs.reserved}`);

    let products: IMatchableProduct[];
    let summary;
    if (write) {
      const result = await context.get(ProductMatchService).syncCatalog(user, marketplace, rows);
      summary = result.match;
      console.log(`Записано в товары:         ${result.written.matched}`);
      products = [];
    } else {
      const [list, unlinked] = await Promise.all([
        context.get(ProductService).listForMatching(user),
        context.get(ProductCardIssueService).unlinkedSkus(user, marketplace),
      ]);
      products = list;
      summary = summarizeMatches(
        matchCards(rows, products, { marketplace, unlinked, createMissing: false }),
      );
    }

    console.log(`Сопоставление карточек ${label.title} с товарами:`);
    if (!write) console.log(`  товаров у продавца:      ${products.length}`);
    console.log(`  уже привязаны:           ${summary.linked}`);
    console.log(
      `  привязаны ${write ? 'сейчас' : 'были бы'}:  штрихкод ${summary.matched.barcode}, ` +
        `артикул производителя ${summary.matched.vendorCode}, артикул ${summary.matched.sku}`,
    );
    console.log(
      `  в очередь:               конфликт ${summary.issues.conflict}, делёж ${summary.issues.shared}, ` +
        `артикул занят ${summary.issues.sku_taken}, нет пары ${summary.issues.no_match}`,
    );
    console.log(`  отвязаны вручную:        ${summary.skipped}`);
    console.log(`  С ТОВАРОМ:               ${summary.boundPercent}% из ${summary.cards}`);
    console.log(`\nВ ${label.title} ничего не записывалось — только чтение.`);
    if (!write) console.log('В Mongo ничего не записывалось. Запись — с --write.');
  } finally {
    await context.close();
  }
}

main().catch((error: Error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
