import 'dotenv/config';
import mongoose from 'mongoose';

import { UserAccessSchema } from '../src/database/schemas/user-access.schema';
import { YandexMarketSchema } from '../src/database/schemas/yandex-market.schema';
import {
  HOSTING_REMINDER_TEXT,
  pickRecipients,
  type IReminderCandidate,
} from '../src/modules/telegram/bots/price-changer-bot/hosting-reminder';
import { FEATURE, isFeatureEnabled } from '../src/modules/telegram/bots/shared/features.domain';
import {
  isLastDayOfMonth,
  moscowDay,
  shiftDays,
  type ICalendarDate,
} from '../src/modules/yandex/reports/moscow-day';

/**
 * Предпросмотр напоминания об оплате хостинга.
 *
 * Зачем. Рассылка уходит раз в месяц, в последний день, — проверить её «как
 * получится» нельзя, ждать месяц ради опечатки в тексте или неверного состава
 * получателей тем более. Скрипт отвечает на оба вопроса за секунду.
 *
 * Скрипт ТОЛЬКО ЧИТАЕТ и НИЧЕГО НЕ ОТПРАВЛЯЕТ: сообщения шлёт очередь, здесь
 * лишь два find в Mongo. Nest намеренно не поднимается (даже AppConfigModule):
 * бутстрап AppModule поднял бы BotRegistry, а тот перенастраивает вебхук и увёл
 * бы его у работающего бота — та же причина, по которой diagnose-скрипты
 * обходятся минимумом.
 *
 * Запуск:
 *   npx ts-node scripts/preview-hosting-reminder.ts
 *   npx ts-node scripts/preview-hosting-reminder.ts --bot=<telegramBotId>
 */

const RULE = '─'.repeat(72);

interface IAccessRow extends IReminderCandidate {
  botId: string;
  username?: string;
  firstName?: string;
}

/** Ближайшая дата отправки: последний день ТЕКУЩЕГО месяца по Москве. */
function nextSendDay(now: Date): string {
  // Тип календарной даты, а не IMoscowDay: shiftDays смещения не возвращает,
  // да оно здесь и не нужно — печатаем только число.
  let date: ICalendarDate = moscowDay(now);
  while (!isLastDayOfMonth(date)) date = shiftDays(date, 1);
  return `${String(date.day).padStart(2, '0')}.${String(date.month).padStart(2, '0')}.${date.year}`;
}

function displayName(row: IAccessRow): string {
  const nick = row.username ? `@${row.username}` : row.firstName || '';
  return `${row.telegramUserId}${nick ? ` (${nick})` : ''}`;
}

async function main(): Promise<void> {
  const url = process.env.MONGODB_URL;
  const dbName = process.env.MONGODB_DATABASE;
  if (!url || !dbName) throw new Error('Нужны MONGODB_URL и MONGODB_DATABASE в .env');

  const botFilter = process.argv.find((a) => a.startsWith('--bot='))?.split('=')[1];

  await mongoose.connect(url, { dbName });
  const Access = mongoose.model('UserAccess', UserAccessSchema);
  const Store = mongoose.model('YandexMarket', YandexMarketSchema);

  const accounts = await Access.find(botFilter ? { botId: botFilter } : {}).lean<IAccessRow[]>();
  const stores = await Store.find({
    telegramUserId: { $in: accounts.map((a) => a.telegramUserId) },
  }).lean<
    Array<{ telegramUserId: string; campaign_id?: string; business_id?: string; token?: string }>
  >();

  const configured = new Set(
    stores.filter((s) => s.campaign_id && s.business_id && s.token).map((s) => s.telegramUserId),
  );

  const now = new Date();
  console.log(RULE);
  console.log(`Ближайшая отправка: ${nextSendDay(now)} в 10:00 МСК`);
  console.log(RULE);
  console.log(HOSTING_REMINDER_TEXT);
  console.log(RULE);

  const recipients = pickRecipients(accounts, configured);
  console.log(`Получателей: ${recipients.length} из ${accounts.length} записей доступа\n`);

  for (const row of accounts) {
    // Решение по строке принимает ТА ЖЕ функция, что и рассылка, — по одной
    // записи за раз. Считать «получит» самостоятельно нельзя: предпросмотр
    // разошёлся бы с боевым правилом молча, а именно за этим сюда и приходят.
    // И ключ здесь — запись, а не пользователь: у одного человека может быть
    // запись под двумя ботами, с разными статусами.
    const willGet = pickRecipients([row], configured).length === 1;

    // Причина печатается ровно одна — первая по порядку отбора: человеку,
    // разбирающему «почему ему не пришло», нужен ответ, а не список условий.
    const reason = willGet
      ? '✅ получит'
      : row.status !== 'approved'
        ? `⏭ статус ${row.status}`
        : !configured.has(row.telegramUserId)
          ? '⏭ магазин не подключён'
          : !isFeatureEnabled(row.features, FEATURE.HOSTING_REMINDER)
            ? '⛔ фича закрыта администратором'
            : '⏭ нет чата в записи доступа';

    console.log(`  ${reason.padEnd(34)} бот ${row.botId.padEnd(12)} ${displayName(row)}`);
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
