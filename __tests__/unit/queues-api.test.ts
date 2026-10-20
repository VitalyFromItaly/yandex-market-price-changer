import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ActionLogService } from '../../src/database/services/action-log.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AdminAuthService } from '../../src/modules/admin/admin-auth.service';
import { AdminJwtGuard } from '../../src/modules/admin/admin-jwt.guard';
import { QueuesController } from '../../src/modules/queues/queues.controller';
import { QueuesService } from '../../src/modules/queues/queues.service';
import { QUEUE_NAMES } from '../../src/modules/telegram';
import { FinanceImportScheduler } from '../../src/modules/telegram/queue/services/finance-import.scheduler';
import { FinanceDiscrepancyRepository } from '../../src/database/postgres/repositories/finance-discrepancy.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { HostingReminderService } from '../../src/modules/telegram/queue/services/hosting-reminder.service';
import { StockPushScheduler } from '../../src/modules/telegram/queue/services/stock-push.scheduler';
import { WeeklyDigestScheduler } from '../../src/modules/telegram/queue/services/weekly-digest.scheduler';
import { STOCK_PUSH_SCHEDULE_LOG_KIND } from '../../src/modules/stock-push/stock-push.service';

/**
 * HTTP-поверхность страницы очередей. Проверяется то, что не ловится
 * компилятором: закрыт ли контроллер гвардом, не утекает ли botToken из
 * payload'ов, и что происходит с именем очереди, пришедшим из браузера.
 */
const BOT_TOKEN = '7000000001:AAF-секретный-токен-бота';

const FAILED_JOB = {
  id: '42',
  name: 'parse-file',
  timestamp: 1754000000000,
  processedOn: 1754000001000,
  finishedOn: 1754000002000,
  attemptsMade: 2,
  failedReason: 'Настройки Yandex Market не найдены',
  opts: { delay: undefined },
  data: {
    userId: '222',
    chatId: 333,
    botToken: BOT_TOKEN,
    fileInfo: { fileName: 'stock.xlsx', filePath: '/app/static/temp/stock.xlsx' },
  },
  getState: vi.fn(async () => 'failed'),
  retry: vi.fn(async () => undefined),
};

function fakeQueue() {
  return {
    getJobCounts: vi.fn(async () => ({
      waiting: 1,
      active: 0,
      completed: 20,
      failed: 3,
      delayed: 2,
    })),
    getRepeatableJobs: vi.fn(async () => []),
    add: vi.fn(async () => undefined),
    getJobs: vi.fn(async () => [FAILED_JOB, null]),
    getJobCountByTypes: vi.fn(async () => 3),
    getJob: vi.fn(async () => FAILED_JOB),
  };
}

describe('QueuesController', () => {
  let queues: Record<string, ReturnType<typeof fakeQueue>>;
  let list: ReturnType<typeof vi.fn>;
  let findByTelegramUsers: ReturnType<typeof vi.fn>;
  let reminderRecipients: ReturnType<typeof vi.fn>;
  let logList: ReturnType<typeof vi.fn>;
  let financeJobs: ReturnType<typeof vi.fn>;
  let financePeriods: ReturnType<typeof vi.fn>;
  let actMismatches: ReturnType<typeof vi.fn>;
  let digestJobs: ReturnType<typeof vi.fn>;
  let digestSendNow: ReturnType<typeof vi.fn>;
  let pushJobs: ReturnType<typeof vi.fn>;
  let pushSendNow: ReturnType<typeof vi.fn>;
  let controller: QueuesController;

  beforeEach(async () => {
    FAILED_JOB.getState.mockClear();
    FAILED_JOB.retry.mockClear();

    queues = Object.fromEntries(Object.values(QUEUE_NAMES).map((name) => [name, fakeQueue()]));
    list = vi.fn(async () => [
      { telegramUserId: '222', botId: '999', username: 'vasya', firstName: 'Вася' },
    ]);
    findByTelegramUsers = vi.fn(async () => [
      {
        telegramUserId: '222',
        name: 'Всё для часов',
        campaign_id: '12345678',
        business_id: '87654321',
        token: 'ACMA:секрет',
      },
    ]);

    reminderRecipients = vi.fn(async () => [
      { botId: '999', telegramUserId: '222', telegramChatId: '333' },
    ]);
    logList = vi.fn(async () => []);
    financeJobs = vi.fn(async () => []);
    financePeriods = vi.fn(async () => []);
    actMismatches = vi.fn(async () => []);
    digestJobs = vi.fn(async () => []);
    digestSendNow = vi.fn(async () => undefined);
    pushJobs = vi.fn(async () => []);
    pushSendNow = vi.fn(async () => undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [QueuesController],
      providers: [
        QueuesService,
        ...Object.entries(queues).map(([name, queue]) => ({
          provide: getQueueToken(name),
          useValue: queue,
        })),
        { provide: UserAccessService, useValue: { list } },
        { provide: YandexMarketService, useValue: { findByTelegramUsers } },
        { provide: HostingReminderService, useValue: { recipients: reminderRecipients } },
        { provide: ActionLogService, useValue: { list: logList } },
        { provide: FinanceImportScheduler, useValue: { jobs: financeJobs } },
        { provide: FinancePeriodRepository, useValue: { listByUsers: financePeriods } },
        { provide: FinanceDiscrepancyRepository, useValue: { listByKind: actMismatches } },
        { provide: WeeklyDigestScheduler, useValue: { jobs: digestJobs, sendNow: digestSendNow } },
        { provide: StockPushScheduler, useValue: { jobs: pushJobs, sendNow: pushSendNow } },
        // Гвард висит на классе; его собственная логика — в admin-auth.test.ts.
        { provide: AdminAuthService, useValue: { verify: async () => '1' } },
      ],
    }).compile();

    controller = moduleRef.get(QueuesController);
  });

  it('весь контроллер закрыт гвардом, а не отдельные методы', () => {
    const guards = Reflect.getMetadata('__guards__', QueuesController) ?? [];
    expect(guards).toContain(AdminJwtGuard);
  });

  it('счётчики отдаются по всем четырём очередям', async () => {
    const { items } = await controller.counts();
    expect(items.map((i) => i.name).sort()).toEqual(Object.values(QUEUE_NAMES).sort());
    expect(items[0].counts).toEqual({
      waiting: 1,
      active: 0,
      completed: 20,
      failed: 3,
      delayed: 2,
    });
  });

  describe('список задач', () => {
    it('botToken и пути на диске НЕ попадают в ответ — несущая проверка', async () => {
      const raw = JSON.stringify(await controller.jobs(QUEUE_NAMES.FILE_PROCESSING, 'failed'));

      expect(raw).not.toContain('botToken');
      expect(raw).not.toContain('7000000001');
      expect(raw).not.toContain('/app/static');
      // Безопасные поля при этом на месте — панели есть что показать.
      expect(raw).toContain('stock.xlsx');
      expect(raw).toContain('parse-file');
    });

    it('строка знает свои очередь и состояние — выдача бывает сводной', async () => {
      const { items } = await controller.jobs(QUEUE_NAMES.FILE_PROCESSING, 'failed');

      expect(items[0].queue).toBe(QUEUE_NAMES.FILE_PROCESSING);
      expect(items[0].state).toBe('failed');
      expect(items[0].failedReason).toContain('Yandex Market');
    });

    it('по умолчанию — ВСЕ состояния ВСЕХ очередей', async () => {
      // Страница открывается сводной картиной, а не одним срезом.
      const result = await controller.jobs('all', undefined);

      for (const queue of Object.values(queues)) {
        expect(queue.getJobs).toHaveBeenCalledTimes(5);
        expect(queue.getJobs).toHaveBeenCalledWith(['failed'], 0, 49);
        expect(queue.getJobs).toHaveBeenCalledWith(['completed'], 0, 49);
      }
      // total — сумма по всем парам (очередь, состояние): 8 очередей × 5 × 3.
      expect(result.total).toBe(120);
    });

    it('одна очередь + состояние all — пять запросов только к ней', async () => {
      await controller.jobs(QUEUE_NAMES.REPORTS, 'all');

      expect(queues[QUEUE_NAMES.REPORTS].getJobs).toHaveBeenCalledTimes(5);
      expect(queues[QUEUE_NAMES.FILE_PROCESSING].getJobs).not.toHaveBeenCalled();
    });

    it('сводная выдача сортируется по времени создания и режется у нас', async () => {
      // Порядок getJobs у Bull различается по состояниям, поэтому страница
      // собирается слиянием: каждый источник отдаёт свой верх до skip+limit.
      const jobOf = (id: string, timestamp: number) => ({ ...FAILED_JOB, id, timestamp });
      queues[QUEUE_NAMES.FILE_PROCESSING].getJobs.mockResolvedValue([
        jobOf('a', 3000),
        jobOf('b', 1000),
        null, // задача, удалённая между сканом индекса и чтением
      ]);
      queues[QUEUE_NAMES.YANDEX_API].getJobs.mockResolvedValue([jobOf('c', 2000)]);
      queues[QUEUE_NAMES.NOTIFICATIONS].getJobs.mockResolvedValue([]);
      queues[QUEUE_NAMES.REPORTS].getJobs.mockResolvedValue([]);
      queues[QUEUE_NAMES.CRM_JOBS].getJobs.mockResolvedValue([]);
      queues[QUEUE_NAMES.FINANCE_IMPORT].getJobs.mockResolvedValue([]);
      queues[QUEUE_NAMES.SELLER_NOTIFICATIONS].getJobs.mockResolvedValue([]);
      queues[QUEUE_NAMES.AI_WEEKLY_DIGEST].getJobs.mockResolvedValue([]);

      const result = await controller.jobs('all', 'failed', '2', '1');

      expect(queues[QUEUE_NAMES.FILE_PROCESSING].getJobs).toHaveBeenCalledWith(['failed'], 0, 2);
      expect(result.items.map((item) => item.id)).toEqual(['c', 'b']);
      expect(result.total).toBe(24); // по 3 failed в каждой из восьми очередей
    });

    it('строка обогащается ником: в payload только числовой id', async () => {
      const { items } = await controller.jobs(QUEUE_NAMES.FILE_PROCESSING, 'failed');

      // У этой задачи пользователь лежит под старым ключом userId и без botId —
      // ник находится по одному telegramUserId.
      expect(items[0]).toMatchObject({ telegramUserId: '222', username: 'vasya' });
      expect(list).toHaveBeenCalledTimes(1);
    });

    it('пара (botId, telegramUserId) точнее одного id', async () => {
      list.mockResolvedValue([
        { telegramUserId: '222', botId: '111', username: 'чужой-бот' },
        { telegramUserId: '222', botId: '999', username: 'vasya' },
      ]);
      queues[QUEUE_NAMES.FILE_PROCESSING].getJobs.mockResolvedValue([
        { ...FAILED_JOB, data: { telegramUserId: 222, botId: '999' } },
      ]);

      const { items } = await controller.jobs(QUEUE_NAMES.FILE_PROCESSING, 'failed');

      // 222 приходит из Redis числом, а записи доступа ключуются строкой.
      expect(items[0]).toMatchObject({ telegramUserId: '222', username: 'vasya' });
    });

    it('задача без пользователя отдаётся как раньше, без похода в Mongo', async () => {
      queues[QUEUE_NAMES.FILE_PROCESSING].getJobs.mockResolvedValue([
        { ...FAILED_JOB, data: { fileInfo: { fileName: 'stock.xlsx' } } },
      ]);

      const { items } = await controller.jobs(QUEUE_NAMES.FILE_PROCESSING, 'failed');

      expect(items[0].telegramUserId).toBeUndefined();
      expect(items[0].data).toEqual({ fileName: 'stock.xlsx' });
      expect(list).not.toHaveBeenCalled();
    });

    it('незнакомый пользователь ника не получает, но строка остаётся', async () => {
      list.mockResolvedValue([]);

      const { items } = await controller.jobs(QUEUE_NAMES.FILE_PROCESSING, 'failed');

      expect(items[0]).toMatchObject({ telegramUserId: '222', id: '42' });
      expect(items[0].username).toBeUndefined();
    });

    it('неизвестная очередь — 400: имя приходит из браузера', async () => {
      await expect(controller.jobs('__proto__', 'failed')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('неизвестное состояние — 400', async () => {
      await expect(controller.jobs(QUEUE_NAMES.REPORTS, 'paused')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('рассылки', () => {
    beforeEach(() => {
      queues[QUEUE_NAMES.REPORTS].getRepeatableJobs.mockResolvedValue([
        {
          key: 'k1',
          id: 'report-999-222-profit',
          cron: '0 9 * * *',
          tz: 'Europe/Moscow',
          next: 1754031600000,
        },
        // Чужая repeatable-задача — пропускается, а не ломает выдачу.
        { key: 'k2', id: 'someone-else', cron: '*/5 * * * *', tz: 'UTC', next: 0 },
      ]);
    });

    it('строка обогащается названием отчёта, пользователем и магазином', async () => {
      const { items } = await controller.digests();

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        botId: '999',
        telegramUserId: '222',
        reportKey: 'profit',
        reportTitle: 'Прибыль',
        time: '09:00',
        username: 'vasya',
        storeName: 'Всё для часов',
      });
    });

    it('магазины запрашиваются ОДНИМ запросом на всех', async () => {
      await controller.digests();
      expect(findByTelegramUsers).toHaveBeenCalledTimes(1);
      expect(findByTelegramUsers).toHaveBeenCalledWith(['222']);
    });

    it('идентификаторы магазина и токен в ответ не попадают', async () => {
      const raw = JSON.stringify(await controller.digests());
      expect(raw).not.toContain('12345678');
      expect(raw).not.toContain('87654321');
      expect(raw).not.toContain('ACMA');
    });
  });

  describe('загрузка финансов', () => {
    const PERIOD = {
      telegramUserId: '222',
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
      status: 'discrepancy',
      lastOutcome: 'unchanged',
      documentVersion: 2,
      unknownCount: 0,
      changedCount: 0,
      removedCount: 1,
      discrepancyCount: 2,
      reconcileState: 'checked',
      reconcileNote: null,
      error: null,
      checkedAt: new Date('2026-10-15T01:07:00Z'),
    };

    it('строка на заведённую задачу: ник, магазин, следующая и последняя загрузка, статусы', async () => {
      financeJobs.mockResolvedValue([
        { telegramUserId: '222', cron: '7 4 * * *', tz: 'Europe/Moscow', next: 1792040820000 },
      ]);
      financePeriods.mockResolvedValue([
        PERIOD,
        {
          ...PERIOD,
          periodFrom: '2026-10-01',
          periodTo: '2026-10-31',
          status: 'preliminary',
          lastOutcome: 'imported',
          removedCount: 0,
          checkedAt: new Date('2026-10-15T01:08:00Z'),
        },
      ]);

      const card = await controller.financeImportCard();

      expect(financePeriods).toHaveBeenCalledWith(['222']);
      expect(card.periodsError).toBeNull();
      expect(card.items).toHaveLength(1);
      expect(card.items[0]).toMatchObject({
        telegramUserId: '222',
        username: 'vasya',
        storeName: 'Всё для часов',
        time: '04:07',
        last: { outcome: 'imported' },
      });
      expect(card.items[0].periods[0]).toMatchObject({
        status: 'discrepancy',
        statusLabel: 'Есть расхождения',
        removedCount: 1,
        discrepancyCount: 2,
        reconcileState: 'checked',
      });
    });

    it('какой акт не сошёлся с отчётом услуг — строкой у своего месяца (TASK-158)', async () => {
      financeJobs.mockResolvedValue([
        { telegramUserId: '222', cron: '7 4 * * *', tz: 'Europe/Moscow', next: 1 },
      ]);
      financePeriods.mockResolvedValue([
        { ...PERIOD, periodKey: 'united-netting:2026-09-01:2026-09-30' },
        {
          ...PERIOD,
          periodFrom: '2026-10-01',
          periodKey: 'united-netting:2026-10-01:2026-10-31',
        },
      ]);
      actMismatches.mockResolvedValue([
        {
          telegramUserId: '222',
          periodKey: 'united-netting:2026-09-01:2026-09-30',
          detail: 'Акт 30.09.2026: услуги 1,00 ₽, удержано по журналу 0,00 ₽, разница 1,00 ₽',
        },
      ]);

      const card = await controller.financeImportCard();

      expect(actMismatches).toHaveBeenCalledWith(['222'], 'act_mismatch');
      expect(card.items[0].periods.map((p) => p.actMismatches)).toEqual([
        ['Акт 30.09.2026: услуги 1,00 ₽, удержано по журналу 0,00 ₽, разница 1,00 ₽'],
        [],
      ]);
    });

    it('Postgres упал — расписание всё равно видно, статусов нет и сказано почему', async () => {
      financeJobs.mockResolvedValue([
        { telegramUserId: '222', cron: '7 4 * * *', tz: 'Europe/Moscow', next: 1 },
      ]);
      financePeriods.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const card = await controller.financeImportCard();
      expect(card.periodsError).toMatch(/ECONNREFUSED/);
      expect(card.items[0]).toMatchObject({ telegramUserId: '222', periods: [], last: null });
    });

    it('задач нет — пустой список без похода в Mongo', async () => {
      const card = await controller.financeImportCard();
      expect(card.items).toEqual([]);
      expect(list).not.toHaveBeenCalled();
    });

    it('идентификаторы магазина и токен в карточку не попадают', async () => {
      financeJobs.mockResolvedValue([
        { telegramUserId: '222', cron: '7 4 * * *', tz: 'Europe/Moscow', next: 1 },
      ]);
      const raw = JSON.stringify(await controller.financeImportCard());
      expect(raw).not.toContain('campaign');
      expect(raw).not.toContain('business');
      expect(raw).not.toContain('token');
    });
  });

  describe('напоминание об оплате хостинга', () => {
    const scheduled = {
      key: 'hk',
      id: 'hosting-reminder',
      cron: '0 10 28-31 * *',
      tz: 'Europe/Moscow',
      next: 1790755200000,
    };

    it('карточка показывает расписание, получателей и последнюю отправку', async () => {
      queues[QUEUE_NAMES.REPORTS].getRepeatableJobs.mockResolvedValue([scheduled]);
      logList.mockResolvedValue([
        {
          createdAt: '2026-08-31T07:00:05.000Z',
          action: 'напоминание об оплате хостинга: отправлено 2 из 2',
          botId: '999',
        },
      ]);

      const card = await controller.hostingReminderCard();

      expect(card.schedule).toMatchObject({ cron: '0 10 28-31 * *', time: '10:00' });
      expect(card.lastRun?.action).toContain('отправлено 2 из 2');
      expect(card.items).toEqual([
        expect.objectContaining({ telegramUserId: '222', username: 'vasya' }),
      ]);
      // Читаем ровно свои строки журнала, а не весь журнал.
      expect(logList).toHaveBeenCalledWith({ kind: 'hosting-reminder', limit: 1 });
    });

    it('задачи нет — schedule: null, это диагноз «развёрнут код без рассылки»', async () => {
      // Персональные рассылки в очереди есть, а нашей задачи нет.
      queues[QUEUE_NAMES.REPORTS].getRepeatableJobs.mockResolvedValue([
        { key: 'k1', id: 'report-999-222-profit', cron: '0 9 * * *', tz: 'Europe/Moscow', next: 1 },
      ]);

      const card = await controller.hostingReminderCard();

      expect(card.schedule).toBeNull();
    });

    it('идентификаторы магазина в карточку не попадают', async () => {
      queues[QUEUE_NAMES.REPORTS].getRepeatableJobs.mockResolvedValue([scheduled]);
      const raw = JSON.stringify(await controller.hostingReminderCard());

      expect(raw).toContain('Всё для часов');
      expect(raw).not.toContain('12345678');
      expect(raw).not.toContain('87654321');
      expect(raw).not.toContain('ACMA');
    });

    it('ручной запуск ставит джобу с force и возвращает число получателей', async () => {
      const result = await controller.runHostingReminder();

      expect(result).toEqual({ queued: true, recipients: 1 });
      expect(queues[QUEUE_NAMES.REPORTS].add).toHaveBeenCalledWith(
        'send-hosting-reminder',
        { force: true },
        expect.objectContaining({ attempts: 1 }),
      );
    });

    it('ручной запуск не создаёт repeatable-задачу и не задаёт jobId', async () => {
      // jobId сделал бы повторное нажатие молчаливым no-op, repeat — второй
      // расписанной рассылкой.
      await controller.runHostingReminder();

      const options = queues[QUEUE_NAMES.REPORTS].add.mock.calls[0][2] as Record<string, unknown>;
      expect(options.repeat).toBeUndefined();
      expect(options.jobId).toBeUndefined();
    });
  });

  describe('ретрай', () => {
    it('упавшая задача перезапускается ровно раз', async () => {
      const result = await controller.retry(QUEUE_NAMES.YANDEX_API, '42');

      expect(FAILED_JOB.retry).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true });
    });

    it('исчезнувшая задача — 404: Redis мог её вычистить', async () => {
      queues[QUEUE_NAMES.YANDEX_API].getJob.mockResolvedValueOnce(null);
      await expect(controller.retry(QUEUE_NAMES.YANDEX_API, '404')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('живая задача НЕ перезапускается — это был бы второй запуск того же', async () => {
      FAILED_JOB.getState.mockResolvedValueOnce('waiting');
      await expect(controller.retry(QUEUE_NAMES.YANDEX_API, '42')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(FAILED_JOB.retry).not.toHaveBeenCalled();
    });

    it('неизвестная очередь — 400 до похода в Redis', async () => {
      await expect(controller.retry('nope', '42')).rejects.toBeInstanceOf(BadRequestException);
      for (const queue of Object.values(queues)) {
        expect(queue.getJob).not.toHaveBeenCalled();
      }
    });

    it('псевдоочередь all для ретрая не годится — нужна настоящая', async () => {
      // Кнопка «Повторить» берёт очередь из самой строки, а не из фильтра.
      await expect(controller.retry('all', '42')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('«Передача остатков» по расписанию', () => {
    it('строка на заведённую задачу: продавец, магазин, следующий запуск и итог последнего прохода', async () => {
      pushJobs.mockResolvedValue([
        {
          telegramUserId: '222',
          cron: '*/30 * * * *',
          tz: 'Europe/Moscow',
          next: 1_700_000_000_000,
        },
      ]);
      logList.mockResolvedValue([
        {
          telegramUserId: '222',
          createdAt: new Date('2026-10-19T10:30:00Z'),
          action: 'новый',
          status: 'ok',
        },
        {
          telegramUserId: '222',
          createdAt: new Date('2026-10-19T10:00:00Z'),
          action: 'старый',
          status: 'error',
        },
      ]);

      const { items } = await controller.stockPushScheduleCard();

      expect(logList).toHaveBeenCalledWith({ kind: STOCK_PUSH_SCHEDULE_LOG_KIND, limit: 200 });
      expect(items).toEqual([
        expect.objectContaining({
          telegramUserId: '222',
          username: 'vasya',
          storeName: 'Всё для часов',
          cron: '*/30 * * * *',
          last: expect.objectContaining({ action: 'новый', status: 'ok' }),
        }),
      ]);
      // Токен магазина в ответ панели не попадает.
      expect(JSON.stringify(items)).not.toContain('ACMA');
    });

    it('«Запустить сейчас» ставит разовый проход; не число — 400 до очереди', async () => {
      await expect(controller.runStockPushSchedule('222')).resolves.toEqual({ queued: true });
      expect(pushSendNow).toHaveBeenCalledWith('222');

      await expect(controller.runStockPushSchedule('2:2')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(pushSendNow).toHaveBeenCalledTimes(1);
    });
  });
});
