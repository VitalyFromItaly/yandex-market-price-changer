import 'dotenv/config';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { PurchasePriceService } from '../src/database/services/purchase-price.service';
import { YandexMarketService } from '../src/database/services/yandex-market.service';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { ProductSeedService } from '../src/modules/yandex/products/product-seed.service';
import { YandexModule } from '../src/modules/yandex/yandex.module';

/**
 * Начальное заполнение базы товаров (`Product`) продавца — из закупа
 * (`PurchasePrice`) и каталога ЯМ (offer-mappings).
 *
 * Пишет ТОЛЬКО нашу Mongo: каталог Маркета читается, ничего в Partner API не
 * записывается. Повторный запуск безопасен — карточки сопоставляются с уже
 * заведёнными товарами (TASK-117), второй прогон даёт «новых 0». Им же догоняются товары, если запись при
 * загрузке прайса однажды упала (она не роняет загрузку, см. StockSyncService).
 *
 * Запуск:
 *   npx ts-node scripts/seed-products.ts --user=<telegramUserId>
 */

// ErrorsModule — явно, хотя он @Global(): см. комментарий в load-purchase-prices.ts.
@Module({ imports: [AppConfigModule, ErrorsModule, YandexModule] })
class SeedModule {}

function parseUser(argv: string[]): string {
  const user = argv.find((a) => a.startsWith('--user='))?.split('=')[1];
  if (!user) throw new Error('Нужен --user=<telegramUserId>');
  return user;
}

async function main(): Promise<void> {
  const user = parseUser(process.argv.slice(2));
  const context = await NestFactory.createApplicationContext(SeedModule, { logger: ['error'] });

  try {
    const store = await context.get(YandexMarketService).findByTelegramUser(user);
    if (!store) throw new Error(`Магазин пользователя ${user} не найден.`);

    console.log('─'.repeat(64));
    console.log(`  МАГАЗИН:  ${store.name ?? '(без названия)'}`);
    console.log(`  БАЗА:     ${process.env.MONGODB_DATABASE}`);
    console.log(`  ЗАКУП:    ${await context.get(PurchasePriceService).countForUser(user)} строк`);
    console.log('─'.repeat(64));

    const summary = await context.get(ProductSeedService).seed({
      telegramUserId: user,
      token: store.token,
      campaign_id: store.campaign_id,
      business_id: store.business_id,
    });

    console.log(`Строк закупа:              ${summary.priceListRows}`);
    console.log(
      `  → товары: новых ${summary.fromPriceList.inserted}, обновлено ${summary.fromPriceList.matched}`,
    );
    console.log(`Позиций каталога ЯМ:       ${summary.catalogOffers}`);
    console.log(
      `  → товары: новых ${summary.fromCatalog.inserted}, обновлено ${summary.fromCatalog.matched}`,
    );
    console.log(`  со штрихкодом:           ${summary.catalogWithBarcodes}`);
    console.log(`  без закупа (себест. ?):  ${summary.catalogWithoutPurchase}`);
    const m = summary.match;
    console.log('Сопоставление карточек ЯМ с товарами:');
    console.log(`  уже привязаны:           ${m.linked}`);
    console.log(
      `  привязаны сейчас:        штрихкод ${m.matched.barcode}, ` +
        `артикул производителя ${m.matched.vendorCode}, артикул ${m.matched.sku}`,
    );
    console.log(`  заведены новым товаром:  ${m.created}`);
    console.log(
      `  в очереди:               конфликт ${m.issues.conflict}, делёж ${m.issues.shared}, ` +
        `артикул занят ${m.issues.sku_taken}`,
    );
    console.log(`  отвязаны вручную:        ${m.skipped}`);
    console.log(`  С ТОВАРОМ:               ${m.boundPercent}% из ${m.cards}`);
    console.log(`Товаров у продавца:        ${summary.productsTotal}`);
    console.log('\nВ Partner API ничего не записывалось — только чтение каталога.');
  } finally {
    await context.close();
  }
}

main().catch((error: Error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
