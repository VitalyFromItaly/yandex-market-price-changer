import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  HOSTING_REMINDER_TEXT,
  pickRecipients,
  type IReminderCandidate,
} from '../../src/modules/telegram/bots/price-changer-bot/hosting-reminder';
import { FEATURE, FEATURE_META } from '../../src/modules/telegram/bots/shared/features.domain';
import { HostingReminderProcessor } from '../../src/modules/telegram/queue/processors/hosting-reminder.processor';
import { HostingReminderService } from '../../src/modules/telegram/queue/services/hosting-reminder.service';
import { HostingReminderScheduler } from '../../src/modules/telegram/queue/services/hosting-reminder.scheduler';
import { isLastDayOfMonth } from '../../src/modules/yandex/reports/moscow-day';

/**
 * Напоминание об оплате хостинга — рассылка раз в месяц.
 *
 * Проверять её «вживую» нельзя: ошибка вылезает через месяц и сразу у всех
 * продавцов. Поэтому обе решающие вещи — «последний ли это день» и «кому
 * уходит» — чистые функции, и здесь они проверяются таблицей случаев.
 */
describe('Последний день месяца', () => {
  const day = (year: number, month: number, d: number) => ({ year, month, day: d });

  it.each([
    ['31 января', day(2026, 1, 31)],
    ['28 февраля невисокосного', day(2026, 2, 28)],
    ['29 февраля високосного', day(2028, 2, 29)],
    ['30 апреля', day(2026, 4, 30)],
    ['31 декабря — переход года', day(2026, 12, 31)],
  ])('%s — последний', (_name, date) => {
    expect(isLastDayOfMonth(date)).toBe(true);
  });

  it.each([
    ['30 января', day(2026, 1, 30)],
    ['27 февраля', day(2026, 2, 27)],
    // Ровно тот случай, ради которого cron будит нас 28–31: в високосный год
    // 28 февраля последним НЕ является.
    ['28 февраля високосного', day(2028, 2, 28)],
    ['29 апреля', day(2026, 4, 29)],
  ])('%s — не последний', (_name, date) => {
    expect(isLastDayOfMonth(date)).toBe(false);
  });

  it('cron задачи покрывает все возможные последние дни', () => {
    // 28–31: короче нельзя (февраль), длиннее незачем.
    expect(HostingReminderScheduler.CRON).toBe('0 10 28-31 * *');
  });
});

describe('Расписание рассылки', () => {
  function build(existing: Array<{ id: string; cron: string; key: string }> = []) {
    const jobs = [...existing];
    const queue = {
      getRepeatableJobs: vi.fn(async () => jobs),
      removeRepeatableByKey: vi.fn(async (key: string) => {
        jobs.splice(
          jobs.findIndex((j) => j.key === key),
          1,
        );
      }),
      add: vi.fn(async () => undefined),
    };
    return { scheduler: new HostingReminderScheduler(queue as never), queue };
  }

  const alive = {
    id: HostingReminderScheduler.JOB_ID,
    cron: HostingReminderScheduler.CRON,
    key: 'live',
  };

  it('на пустой очереди заводит ОДНУ задачу в 10:00 МСК', async () => {
    const { scheduler, queue } = build();
    await scheduler.ensureScheduled();

    expect(queue.add).toHaveBeenCalledTimes(1);
    const options = queue.add.mock.calls[0][2] as {
      jobId: string;
      repeat: { cron: string; tz: string };
      attempts: number;
    };
    expect(options.jobId).toBe(HostingReminderScheduler.JOB_ID);
    expect(options.repeat).toEqual({ cron: '0 10 28-31 * *', tz: 'Europe/Moscow' });
    // Повтор упавшей рассылки прислал бы напоминание второй раз тем, кому оно
    // уже ушло.
    expect(options.attempts).toBe(1);
  });

  it('рестарт дубля не создаёт — иначе напоминание пришло бы дважды', async () => {
    const { scheduler, queue } = build([alive]);
    await scheduler.ensureScheduled();

    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it('смена времени снимает прежнюю задачу, а не оставляет обе', async () => {
    const stale = { id: HostingReminderScheduler.JOB_ID, cron: '0 18 28-31 * *', key: 'stale' };
    const { scheduler, queue } = build([stale]);

    await scheduler.ensureScheduled();

    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('stale');
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('чужие расписания не трогает', async () => {
    // Персональные рассылки отчётов живут в той же очереди.
    const personal = { id: 'report:999:100:report_profit', cron: '0 9 * * *', key: 'personal' };
    const { scheduler, queue } = build([personal, alive]);

    await scheduler.ensureScheduled();

    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('Отбор получателей напоминания', () => {
  const candidate = (over: Partial<IReminderCandidate> = {}): IReminderCandidate => ({
    telegramUserId: '100',
    telegramChatId: '100',
    status: 'approved',
    ...over,
  });

  const ids = (candidates: IReminderCandidate[], configured: string[]) =>
    pickRecipients(candidates, new Set(configured)).map((r) => r.telegramUserId);

  it('одобренный с подключённым магазином получает', () => {
    expect(ids([candidate()], ['100'])).toEqual(['100']);
  });

  it.each(['new', 'pending', 'rejected'])('статус %s не получает', (status) => {
    expect(ids([candidate({ status })], ['100'])).toEqual([]);
  });

  it('одобренный БЕЗ магазина не получает', () => {
    // Нагрузку на хостинг создаёт тот, кто подключил токен.
    expect(ids([candidate()], [])).toEqual([]);
  });

  it('закрытая администратором фича отменяет рассылку этому продавцу', () => {
    const closed = candidate({ features: { [FEATURE.HOSTING_REMINDER]: false } });
    expect(ids([closed], ['100'])).toEqual([]);
  });

  it('отсутствие ключа — не «выключено»: напоминание включено по умолчанию', () => {
    expect(FEATURE_META[FEATURE.HOSTING_REMINDER].defaultEnabled).toBe(true);
    expect(ids([candidate({ features: { report_profit: false } })], ['100'])).toEqual(['100']);
  });

  it('запись без чата пропускается молча, остальные получают', () => {
    // sendMessage без chat_id ответил бы 400, а падение лишило бы напоминания
    // всех, кто в списке дальше.
    const broken = candidate({ telegramUserId: '200', telegramChatId: '' });
    expect(ids([broken, candidate()], ['100', '200'])).toEqual(['100']);
  });
});

describe('Процессор рассылки', () => {
  // Подменяем ТОЛЬКО Date: setTimeout остаётся настоящим, иначе пауза между
  // отправками не разрешилась бы и тест повис.
  const atMoscow = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) });
  afterEach(() => vi.useRealTimers());

  function build(accounts: IReminderCandidate[], stores: string[]) {
    const sendMessage = vi.fn(async () => undefined);
    const bot = { telegramId: 999, telegraf: { telegram: { sendMessage } } };
    const record = vi.fn(async () => undefined);

    // Отбор получателей — настоящий сервис поверх фейковых репозиториев: то же
    // правило, что покажет панель. Подменить его целиком значило бы проверять
    // рассылку в отрыве от того, кого она выбирает.
    const recipients = new HostingReminderService(
      { all: () => [bot] } as never,
      { listByBot: vi.fn(async () => accounts) } as never,
      {
        findByTelegramUsers: vi.fn(async () =>
          stores.map((id) => ({
            telegramUserId: id,
            campaign_id: '1',
            business_id: '2',
            token: 't',
          })),
        ),
      } as never,
    );

    const processor = new HostingReminderProcessor(
      { all: () => [bot] } as never,
      recipients,
      { record } as never,
      { report: vi.fn(async () => undefined) } as never,
    );

    return { processor, sendMessage, record };
  }

  /** Тик расписания приходит без данных, кнопка панели — с `force`. */
  const tick = (force = false) => ({ data: force ? { force: true } : {} }) as never;

  const seller = (id: string): IReminderCandidate => ({
    telegramUserId: id,
    telegramChatId: id,
    status: 'approved',
  });

  it('в НЕ последний день не уходит ничего', async () => {
    // Задача будит процессор 28–31 числа, и три раза из четырёх это штатное
    // «сегодня не тот день», а не сбой.
    atMoscow('2026-08-30T07:00:00Z');
    const { processor, sendMessage } = build([seller('100')], ['100']);

    await processor.run(tick());

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('в последний день уходит текст рассылки каждому получателю', async () => {
    // 31 августа 2026, 10:00 МСК = 07:00 UTC.
    atMoscow('2026-08-31T07:00:00Z');
    const { processor, sendMessage } = build([seller('100'), seller('200')], ['100', '200']);

    await processor.run(tick());

    expect(sendMessage.mock.calls.map((c) => c[0])).toEqual(['100', '200']);
    expect(sendMessage.mock.calls[0][1]).toBe(HOSTING_REMINDER_TEXT);
    // Разметка HTML: в тексте есть <b>, и без parse_mode он ушёл бы с тегами.
    expect(sendMessage.mock.calls[0][2]).toMatchObject({ parse_mode: 'HTML' });
  });

  it('заблокировавший бота не срывает рассылку остальным', async () => {
    atMoscow('2026-08-31T07:00:00Z');
    const { processor, sendMessage } = build([seller('100'), seller('200')], ['100', '200']);
    sendMessage.mockRejectedValueOnce(new Error('403: bot was blocked by the user'));

    await expect(processor.run(tick())).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('кнопка панели (force) шлёт и НЕ в последний день месяца', async () => {
    // Иначе убедиться, что рассылка работает, можно было бы только дождавшись
    // последнего дня месяца.
    atMoscow('2026-08-12T07:00:00Z');
    const { processor, sendMessage } = build([seller('100')], ['100']);

    await processor.run(tick(true));

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('force обходит ТОЛЬКО проверку даты, но не отбор получателей', async () => {
    // Ручной запуск не должен уметь написать тому, кому рассылка закрыта.
    atMoscow('2026-08-12T07:00:00Z');
    const closed = { ...seller('100'), features: { hosting_reminder: false } };
    const { processor, sendMessage } = build([closed], ['100']);

    await processor.run(tick(true));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('о рассылке остаётся строка в журнале — по ней панель показывает последнюю отправку', async () => {
    atMoscow('2026-08-31T07:00:00Z');
    const { processor, record } = build([seller('100')], ['100']);

    await processor.run(tick());

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'hosting-reminder',
        telegramUserId: 'system',
        botId: '999',
        action: expect.stringContaining('отправлено 1 из 1'),
      }),
    );
  });

  it('«получателей нет» тоже пишется в журнал: молчание не ответ', async () => {
    atMoscow('2026-08-31T07:00:00Z');
    const { processor, record } = build([seller('100')], []);

    await processor.run(tick());

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.stringContaining('получателей нет') }),
    );
  });

  it('в НЕ последний день журнал не трогается вовсе', async () => {
    // Три холостых пробуждения из четырёх не должны засорять журнал.
    atMoscow('2026-08-30T07:00:00Z');
    const { processor, record } = build([seller('100')], ['100']);

    await processor.run(tick());

    expect(record).not.toHaveBeenCalled();
  });

  it('получателей нет — ни одного запроса в Telegram', async () => {
    atMoscow('2026-08-31T07:00:00Z');
    const { processor, sendMessage } = build([seller('100')], []);

    await processor.run(tick());

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
