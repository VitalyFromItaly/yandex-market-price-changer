import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Очистка базы.
 *
 * ОПЕРАЦИЯ НЕОБРАТИМА. Восстановить удалённое можно только из резервной копии,
 * которой у этого проекта нет. Поэтому:
 *
 *  1. По умолчанию скрипт НИЧЕГО НЕ УДАЛЯЕТ — показывает, что удалил бы.
 *     Запись включается явным флагом `--apply`.
 *  2. Имя базы печатается крупно перед любым действием. Перепутать тестовую и
 *     боевую базу — самая дешёвая и самая дорогая ошибка в таких скриптах:
 *     обе строки подключения выглядят одинаково, отличаясь одним словом.
 *  3. Перед удалением делается пауза, чтобы успеть нажать Ctrl+C.
 *
 * Режимы:
 *   --mode=obsolete  (по умолчанию) удалить только коллекции, которых нет ни в
 *                    одной схеме проекта. Это остатки удалённых функций —
 *                    например `subscriptions` после перехода на UserAccess.
 *                    Данные живых коллекций не трогаются.
 *   --mode=data      очистить содержимое ВСЕХ коллекций проекта, оставив сами
 *                    коллекции и индексы. Полный сброс на «чистый лист».
 *   --mode=all       и то, и другое.
 *
 * Примеры:
 *   npm run db:clean                      — показать, что будет удалено
 *   npm run db:clean -- --mode=data       — показать полный сброс
 *   npm run db:clean -- --apply           — удалить устаревшие коллекции
 *   npm run db:clean -- --mode=all --apply
 */

/** Коллекции, которые создаёт текущий код. Всё прочее в базе — наследие. */
const KNOWN_COLLECTIONS = [
  'bots',
  'users',
  'useraccesses',
  'reportschedules',
  'yandexmarkets',
] as const;

/**
 * Коллекции, которые нельзя чистить в режиме `data`.
 *
 * `bots` содержит токены Telegram: очистив её, вы потеряете подключение бота,
 * и приложение при следующем старте пересоздаст запись из TELEGRAM_TOKEN —
 * то есть остальные боты, если их несколько, просто исчезнут.
 */
const PROTECTED_FROM_WIPE = new Set(['bots']);

const PAUSE_BEFORE_WRITE_MS = 5_000;

type TMode = 'obsolete' | 'data' | 'all';

function parseArgs(argv: string[]): { apply: boolean; mode: TMode; force: boolean } {
  const apply = argv.includes('--apply');
  const force = argv.includes('--force');
  const modeArg = argv.find((a) => a.startsWith('--mode='))?.split('=')[1];

  const mode = (modeArg ?? 'obsolete') as TMode;
  if (!['obsolete', 'data', 'all'].includes(mode)) {
    throw new Error(`Неизвестный режим «${mode}». Допустимы: obsolete, data, all`);
  }

  return { apply, mode, force };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const { apply, mode, force } = parseArgs(process.argv.slice(2));

  const url = process.env.MONGODB_URL;
  const dbName = process.env.MONGODB_DATABASE;

  if (!url || !dbName) {
    throw new Error('Нужны MONGODB_URL и MONGODB_DATABASE в .env');
  }

  await mongoose.connect(url, { dbName });
  const db = mongoose.connection.db;

  // Хост без пароля — чтобы в логе было видно, КУДА подключились, но не с чем.
  const host = url.replace(/\/\/[^@]+@/, '//***@');

  console.log('─'.repeat(64));
  console.log(`  БАЗА:   ${dbName}`);
  console.log(`  СЕРВЕР: ${host}`);
  console.log(`  РЕЖИМ:  ${mode}`);
  console.log(
    `  ${apply ? '⚠️  БОЕВОЙ ЗАПУСК — БУДЕТ УДАЛЕНО' : '🔍 сухой прогон, ничего не удаляется'}`,
  );
  console.log('─'.repeat(64));
  console.log();

  const existing = await db.listCollections().toArray();
  const names = existing.map((c) => c.name).sort();

  const obsolete = names.filter((n) => !KNOWN_COLLECTIONS.includes(n as never));
  const known = names.filter((n) => KNOWN_COLLECTIONS.includes(n as never));

  // Считаем ДО удаления: после уже не покажешь, что именно потеряли.
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, await db.collection(name).countDocuments());
  }

  console.log('Коллекции в базе:');
  for (const name of names) {
    const tag = obsolete.includes(name) ? ' ← нет в схемах' : '';
    console.log(`   ${name.padEnd(20)} ${String(counts.get(name)).padStart(7)} док.${tag}`);
  }
  console.log();

  const dropList = mode === 'data' ? [] : obsolete;
  const wipeList = mode === 'obsolete' ? [] : known.filter((n) => !PROTECTED_FROM_WIPE.has(n));
  const protectedHit = mode === 'obsolete' ? [] : known.filter((n) => PROTECTED_FROM_WIPE.has(n));

  if (!dropList.length && !wipeList.length) {
    console.log('✅ Удалять нечего — база уже в нужном состоянии.');
    await mongoose.disconnect();
    return;
  }

  if (dropList.length) {
    console.log('БУДУТ УДАЛЕНЫ ЦЕЛИКОМ (коллекций нет ни в одной схеме):');
    for (const n of dropList) console.log(`   ✗ ${n} (${counts.get(n)} док.)`);
    console.log();
  }

  if (wipeList.length) {
    console.log('БУДЕТ ОЧИЩЕНО СОДЕРЖИМОЕ (коллекции и индексы останутся):');
    for (const n of wipeList) console.log(`   ✗ ${n} (${counts.get(n)} док.)`);
    console.log();
  }

  if (protectedHit.length) {
    console.log('ЗАЩИЩЕНЫ ОТ ОЧИСТКИ (снимается флагом --force):');
    for (const n of protectedHit) {
      console.log(`   ● ${n} (${counts.get(n)} док.) — здесь токены ботов`);
    }
    console.log();
  }

  if (!apply) {
    console.log('Ничего не удалено. Для реального запуска добавьте --apply');
    await mongoose.disconnect();
    return;
  }

  const total = [...dropList, ...wipeList].reduce((s, n) => s + (counts.get(n) ?? 0), 0);
  console.log(`⚠️  Будет безвозвратно удалено ${total} документов из базы «${dbName}».`);
  console.log(`   Отменить: Ctrl+C в течение ${PAUSE_BEFORE_WRITE_MS / 1000} секунд…`);
  await sleep(PAUSE_BEFORE_WRITE_MS);
  console.log();

  for (const name of dropList) {
    await db.collection(name).drop();
    console.log(`   удалена коллекция ${name}`);
  }

  const wipeTargets = force ? known : known.filter((n) => !PROTECTED_FROM_WIPE.has(n));

  for (const name of mode === 'obsolete' ? [] : wipeTargets) {
    const { deletedCount } = await db.collection(name).deleteMany({});
    console.log(`   очищена ${name}: удалено ${deletedCount}`);
  }

  console.log('\n✅ Готово.');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Ошибка:', error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
