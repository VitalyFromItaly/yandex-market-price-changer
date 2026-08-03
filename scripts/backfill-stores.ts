import 'dotenv/config';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { YandexMarketService } from '../src/database/services/yandex-market.service';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { YandexClientFactory } from '../src/modules/yandex/yandex-client.factory';
import { YandexModule } from '../src/modules/yandex/yandex.module';

/**
 * Разовый бэкфилл кэша магазинов (`YandexMarket.stores`).
 *
 * Зачем. Кнопку «🏪 Сменить магазин» рисуют по непустому `stores`, а заполняет
 * его бот только в момент ПОДКЛЮЧЕНИЯ токена. У всех, кто подключился раньше,
 * поля нет — и кнопка не появится, даже когда токен открывает четыре магазина.
 * `ensureStoresCached` чинит это само, но только когда продавец в следующий раз
 * откроет меню; этот скрипт делает то же самое сразу и для всех.
 *
 * Только чтение Partner API (`GET v2/campaigns`) и запись в НАШУ базу. В
 * магазине не меняется ничего.
 *
 * Загружает `AppConfigModule + ErrorsModule + YandexModule`, а НЕ `AppModule`:
 * тот поднял бы `BotRegistry`, чей bootstrap переставляет вебхук и увёл бы
 * обновления от работающего бота. `AppConfigModule` и `ErrorsModule`
 * импортируются ЯВНО, хотя оба `@Global()`: глобальность делает провайдеры
 * видимыми из уже загруженного модуля, но сам модуль в контекст не втягивает —
 * без `ErrorsModule` сборка падает на `ErrorReporter` внутри `ProfitService`.
 *
 * Запуск:
 *   npx ts-node scripts/backfill-stores.ts                 # только те, у кого кэша нет
 *   npx ts-node scripts/backfill-stores.ts --dry           # ничего не писать, только показать
 *   npx ts-node scripts/backfill-stores.ts --force         # перечитать и у тех, у кого кэш есть
 *   npx ts-node scripts/backfill-stores.ts --user=<id>     # один продавец
 */

@Module({ imports: [AppConfigModule, ErrorsModule, YandexModule] })
class BackfillModule {}

interface IArgs {
  dry: boolean;
  force: boolean;
  user?: string;
}

function parseArgs(argv: string[]): IArgs {
  return {
    dry: argv.includes('--dry'),
    force: argv.includes('--force'),
    user: argv.find((a) => a.startsWith('--user='))?.split('=')[1],
  };
}

async function main(): Promise<void> {
  const { dry, force, user } = parseArgs(process.argv.slice(2));

  const context = await NestFactory.createApplicationContext(BackfillModule, { logger: ['error'] });

  try {
    const marketService = context.get(YandexMarketService);
    const clients = context.get(YandexClientFactory);

    const all = await marketService.getAll();
    const stores = user ? all.filter((s) => s.telegramUserId === user) : all;

    console.log('─'.repeat(72));
    console.log(`  БАЗА:     ${process.env.MONGODB_DATABASE}`);
    console.log(`  МАГАЗИНОВ: ${stores.length}${user ? ` (фильтр --user=${user})` : ''}`);
    console.log(`  РЕЖИМ:    ${dry ? 'холостой (--dry), запись не идёт' : 'запись в базу'}`);
    console.log('─'.repeat(72));

    let filled = 0;
    let skipped = 0;
    let failed = 0;

    for (const store of stores) {
      const id = store.telegramUserId ?? '(без telegramUserId)';
      const title = store.name ?? '(без названия)';

      if (!store.token || !store.telegramUserId) {
        console.log(`⏭  ${id} ${title}: нет токена — пропуск`);
        skipped++;
        continue;
      }

      const cached = store.stores?.length ?? 0;
      if (cached && !force) {
        console.log(`⏭  ${id} ${title}: кэш уже есть (${cached}) — пропуск, нужен --force`);
        skipped++;
        continue;
      }

      try {
        // forTokenOnly: campaign_id/business_id для списка кампаний не нужны, а
        // у документа они могут указывать на кабинет, которого токен уже не
        // открывает, — тогда forStore собрал бы клиента с мёртвой парой.
        const fresh = await clients.forTokenOnly(store.token).listStores();

        if (!fresh.length) {
          console.log(`⚠️  ${id} ${title}: Маркет вернул пустой список — не трогаем`);
          failed++;
          continue;
        }

        if (!dry) {
          await marketService.updateByTelegramUser(store.telegramUserId, { stores: fresh });
        }

        // Кнопка появляется только при >1: печатаем это прямо, иначе «записано
        // 1» читается как успех, а продавец кнопки так и не увидит.
        const button = fresh.length > 1 ? 'кнопка появится' : 'кнопки не будет (магазин один)';
        console.log(`✅ ${id} ${title}: магазинов ${fresh.length} — ${button}`);
        for (const s of fresh) {
          const mark = s.campaignId === store.campaign_id ? '✓' : ' ';
          console.log(`     ${mark} ${s.campaignId} ${s.placementType ?? '—'} ${s.storeName}`);
        }
        filled++;
      } catch (error) {
        console.log(
          `❌ ${id} ${title}: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`,
        );
        failed++;
      }
    }

    console.log('─'.repeat(72));
    console.log(`Обновлено: ${filled}   пропущено: ${skipped}   с ошибкой: ${failed}`);
    if (dry) {
      console.log('Холостой прогон — в базу ничего не записано.');
    } else if (filled) {
      console.log('Кнопка появится при следующей отрисовке меню: /start или «🏠 Главное меню».');
    }
  } finally {
    await context.close();
  }
}

main().catch((error: Error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
