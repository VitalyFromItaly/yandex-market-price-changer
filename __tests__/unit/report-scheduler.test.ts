import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ReportSchedulerService } from '../../src/modules/telegram/queue/services/report-scheduler.service';
import { ReportScheduleService } from '../../src/database/services/report-schedule.service';
import { QUEUE_NAMES } from '../../src/modules/telegram';
import { MOSCOW_TIME_ZONE } from '../../src/modules/yandex/reports/moscow-day';

const KEY = { telegramUserId: '222', botId: '999', reportKey: 'redeemed' };
const JOB_ID = 'report:999:222:redeemed';

/** Очередь-заглушка с реалистичным поведением repeatable-задач Bull. */
function fakeQueue(initial: Array<{ id: string; cron: string; key: string }> = []) {
  const repeatables = [...initial];

  return {
    repeatables,
    add: vi.fn(async (name: string, data: unknown, opts: never) => {
      const o = opts as { jobId: string; repeat: { cron: string; tz: string } };
      repeatables.push({ id: o.jobId, cron: o.repeat.cron, key: `${o.jobId}:${o.repeat.cron}` });
      return { id: o.jobId, name, data };
    }),
    getRepeatableJobs: vi.fn(async () => [...repeatables]),
    removeRepeatableByKey: vi.fn(async (key: string) => {
      const i = repeatables.findIndex((j) => j.key === key);
      if (i >= 0) repeatables.splice(i, 1);
    }),
  };
}

async function build(queue: ReturnType<typeof fakeQueue>, enabled: unknown[] = []) {
  const schedules = { listEnabled: vi.fn(async () => enabled) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      ReportSchedulerService,
      { provide: getQueueToken(QUEUE_NAMES.REPORTS), useValue: queue },
      { provide: ReportScheduleService, useValue: schedules },
    ],
  }).compile();
  return moduleRef.get(ReportSchedulerService);
}

describe('Идентификатор задачи', () => {
  it('выводится из пользователя, бота и отчёта — стабилен между запусками', () => {
    // Случайный id означал бы, что повторное включение добавляет ВТОРУЮ задачу
    // и отчёт начинает приходить дважды в день.
    expect(ReportSchedulerService.jobId(KEY)).toBe(JOB_ID);
    expect(ReportSchedulerService.jobId({ ...KEY })).toBe(JOB_ID);
  });

  it('разные отчёты одного пользователя не конфликтуют', () => {
    const a = ReportSchedulerService.jobId({ ...KEY, reportKey: 'redeemed' });
    const b = ReportSchedulerService.jobId({ ...KEY, reportKey: 'returning' });
    expect(a).not.toBe(b);
  });

  it('разные пользователи не конфликтуют', () => {
    expect(ReportSchedulerService.jobId({ ...KEY, telegramUserId: '1' })).not.toBe(
      ReportSchedulerService.jobId({ ...KEY, telegramUserId: '2' }),
    );
  });
});

describe('Создание расписания', () => {
  let queue: ReturnType<typeof fakeQueue>;

  beforeEach(() => {
    queue = fakeQueue();
  });

  it('часовой пояс передаётся Bull явно', async () => {
    // Пересчёт в UTC руками означал бы, что при изменении правил пояса
    // рассылка, заданная на 9 утра, молча уедет на другой час.
    const scheduler = await build(queue);
    await scheduler.schedule(KEY, '09:30');

    const opts = queue.add.mock.calls[0][2] as never as {
      repeat: { cron: string; tz: string };
    };
    expect(opts.repeat.tz).toBe(MOSCOW_TIME_ZONE);
    expect(opts.repeat.cron).toBe('30 9 * * *');
  });

  it('включение ДВАЖДЫ подряд не создаёт дубля', async () => {
    const scheduler = await build(queue);
    await scheduler.schedule(KEY, '09:00');
    await scheduler.schedule(KEY, '09:00');

    expect(queue.repeatables).toHaveLength(1);
  });

  it('изменение времени переносит задачу, не оставляя старую', async () => {
    const scheduler = await build(queue);
    await scheduler.schedule(KEY, '09:00');
    await scheduler.schedule(KEY, '21:30');

    expect(queue.repeatables).toHaveLength(1);
    expect(queue.repeatables[0].cron).toBe('30 21 * * *');
  });

  it('в payload задачи попадает только ключ', async () => {
    // Между созданием расписания и запуском проходят сутки: адрес получателя
    // нужно брать свежим, а не из задачи месячной давности.
    const scheduler = await build(queue);
    await scheduler.schedule(KEY, '09:00');

    expect(queue.add.mock.calls[0][1]).toEqual(KEY);
  });

  it('снятие убирает задачу', async () => {
    const scheduler = await build(queue);
    await scheduler.schedule(KEY, '09:00');
    await scheduler.unschedule(KEY);

    expect(queue.repeatables).toHaveLength(0);
  });

  it('снятие несуществующей задачи не падает', async () => {
    const scheduler = await build(queue);
    await expect(scheduler.unschedule(KEY)).resolves.toBeUndefined();
  });
});

describe('Сверка при старте (TASK-031)', () => {
  const enabledDoc = (over = {}) => ({ ...KEY, time: '09:00', enabled: true, ...over });

  it('отсутствующая задача создаётся', async () => {
    // Задачу могли удалить из Redis вручную или потерять при сбросе базы.
    const queue = fakeQueue();
    const scheduler = await build(queue, [enabledDoc()]);

    const result = await scheduler.reconcile();

    expect(result.added).toBe(1);
    expect(queue.repeatables).toHaveLength(1);
  });

  it('лишняя задача снимается: рассылку выключили', async () => {
    const queue = fakeQueue([{ id: JOB_ID, cron: '0 9 * * *', key: 'k1' }]);
    const scheduler = await build(queue, []);

    const result = await scheduler.reconcile();

    expect(result.removed).toBe(1);
    expect(queue.repeatables).toHaveLength(0);
  });

  it('устаревшее время переносится, дубля не остаётся', async () => {
    const queue = fakeQueue([{ id: JOB_ID, cron: '0 9 * * *', key: 'k1' }]);
    const scheduler = await build(queue, [enabledDoc({ time: '21:30' })]);

    const result = await scheduler.reconcile();

    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
    expect(queue.repeatables).toHaveLength(1);
    expect(queue.repeatables[0].cron).toBe('30 21 * * *');
  });

  it('совпадающая задача не пересоздаётся', async () => {
    const queue = fakeQueue([{ id: JOB_ID, cron: '0 9 * * *', key: 'k1' }]);
    const scheduler = await build(queue, [enabledDoc()]);

    const result = await scheduler.reconcile();

    expect(result).toEqual({ added: 0, removed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('ТРИ рестарта подряд не увеличивают количество задач', async () => {
    // Именно так проявляется задвоение: каждый деплой добавляет ещё одну
    // рассылку, и через неделю пользователь получает семь отчётов в день.
    const queue = fakeQueue();
    const scheduler = await build(queue, [enabledDoc()]);

    await scheduler.reconcile();
    await scheduler.reconcile();
    await scheduler.reconcile();

    expect(queue.repeatables).toHaveLength(1);
  });

  it('выключенная рассылка не получает задачу даже после рестарта', async () => {
    const queue = fakeQueue();
    // listEnabled отдаёт только включённые — выключенных здесь нет вовсе.
    const scheduler = await build(queue, []);

    await scheduler.reconcile();

    expect(queue.repeatables).toHaveLength(0);
  });

  it('сверка на старте не роняет приложение при недоступном Redis', async () => {
    // Без сверки бот работает, просто расписания могут разъехаться до
    // следующего старта. Падение при старте хуже.
    const queue = fakeQueue();
    queue.getRepeatableJobs = vi.fn(async () => {
      throw new Error('Redis недоступен');
    });
    const scheduler = await build(queue, []);

    await expect(scheduler.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
