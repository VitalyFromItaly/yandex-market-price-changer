import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AdminAuthService } from '../../src/modules/admin/admin-auth.service';
import { AdminJwtGuard } from '../../src/modules/admin/admin-jwt.guard';
import { QueuesController } from '../../src/modules/queues/queues.controller';
import { QueuesService } from '../../src/modules/queues/queues.service';
import { QUEUE_NAMES } from '../../src/modules/telegram';

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
    getJobs: vi.fn(async () => [FAILED_JOB, null]),
    getJobCountByTypes: vi.fn(async () => 3),
    getJob: vi.fn(async () => FAILED_JOB),
  };
}

describe('QueuesController', () => {
  let queues: Record<string, ReturnType<typeof fakeQueue>>;
  let list: ReturnType<typeof vi.fn>;
  let findByTelegramUsers: ReturnType<typeof vi.fn>;
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
      // total — сумма по всем парам (очередь, состояние): 4 × 5 × 3.
      expect(result.total).toBe(60);
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

      const result = await controller.jobs('all', 'failed', '2', '1');

      expect(queues[QUEUE_NAMES.FILE_PROCESSING].getJobs).toHaveBeenCalledWith(['failed'], 0, 2);
      expect(result.items.map((item) => item.id)).toEqual(['c', 'b']);
      expect(result.total).toBe(12);
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
          id: 'report:999:222:profit',
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
});
