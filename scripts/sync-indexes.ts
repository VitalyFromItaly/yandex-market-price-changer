import 'dotenv/config';
import mongoose from 'mongoose';
import { BotSchema } from '../src/database/schemas/bot.schema';
import { UserSchema } from '../src/database/schemas/user.schema';
import { UserAccessSchema } from '../src/database/schemas/user-access.schema';
import { ReportScheduleSchema } from '../src/database/schemas/report-schedule.schema';
import { YandexMarketSchema } from '../src/database/schemas/yandex-market.schema';

/**
 * Приведение индексов существующей базы к схемам.
 *
 * Зачем отдельный скрипт, а не автоматика при старте. Mongoose при подключении
 * создаёт ОТСУТСТВУЮЩИЕ индексы, но НЕ трогает уже существующий с тем же
 * набором полей. То есть объявить `unique: true` над полем, у которого уже есть
 * обычный индекс, недостаточно: в схеме будет одно, в базе другое, и никакой
 * ошибки при этом не возникнет. Ровно так и разъехались индексы после миграции
 * схем — в базе нашлись индексы по полям `campaignId`, `businessId`, `userId`,
 * которых в схемах нет уже давно.
 *
 * `syncIndexes()` умеет и удалять лишнее, поэтому вызывать его на каждом старте
 * приложения нельзя: пересоздание индекса на большой коллекции — это блокировка
 * и время. Здесь это осознанная разовая операция.
 *
 * Запуск: npm run db:sync-indexes
 */
const MODELS = [
  { name: 'Bot', schema: BotSchema },
  { name: 'User', schema: UserSchema },
  { name: 'UserAccess', schema: UserAccessSchema },
  { name: 'ReportSchedule', schema: ReportScheduleSchema },
  { name: 'YandexMarket', schema: YandexMarketSchema },
];

async function main(): Promise<void> {
  const url = process.env.MONGODB_URL;
  const dbName = process.env.MONGODB_DATABASE;

  if (!url || !dbName) {
    throw new Error('Нужны MONGODB_URL и MONGODB_DATABASE в .env');
  }

  await mongoose.connect(url, { dbName });
  console.log(`База: ${dbName}\n`);

  for (const { name, schema } of MODELS) {
    // autoIndex: false — индексы создаёт именно syncIndexes, а не подключение.
    const model = mongoose.model(name, schema.clone().set('autoIndex', false));

    const before = await safeIndexes(model);
    const dropped: string[] = await model.syncIndexes();
    const after = await safeIndexes(model);

    console.log(`${model.collection.name}:`);
    if (dropped.length) console.log(`  снято: ${dropped.join(', ')}`);

    const created = after.filter((i) => !before.includes(i));
    if (created.length) console.log(`  создано: ${created.join(', ')}`);
    if (!dropped.length && !created.length) console.log('  без изменений');

    for (const index of await model.collection.indexes()) {
      const flags = [index.unique && 'UNIQUE', index.sparse && 'SPARSE'].filter(Boolean).join(' ');
      console.log(`    ${JSON.stringify(index.key)}${flags ? '  ' + flags : ''}`);
    }
    console.log('');
  }

  await mongoose.disconnect();
}

/**
 * Список имён индексов; на отсутствующей коллекции — пустой.
 *
 * Тип модели здесь намеренно нестрогий: скрипт обходит РАЗНЫЕ модели одним
 * циклом, а обобщённый Model<T> от mongoose к общему знаменателю не сводится.
 */
async function safeIndexes(model: {
  collection: { indexes(): Promise<Array<{ name?: string }>> };
}): Promise<string[]> {
  try {
    return (await model.collection.indexes()).map((i) => String(i.name));
  } catch {
    return [];
  }
}

main().catch((error) => {
  console.error('Не удалось синхронизировать индексы:', error.message);
  process.exit(1);
});
