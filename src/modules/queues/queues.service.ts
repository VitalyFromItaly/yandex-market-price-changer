import type { TJobState } from './queues.domain';

import { InjectQueue } from '@nestjs/bull';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bull';

import { QUEUE_NAMES } from '../telegram';

import { safeJobData, cronToTime, parseReportJobId } from './queues.domain';

export interface IQueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface IQueueSummary {
  name: string;
  counts: IQueueCounts;
}

/** Repeatable-задача рассылки, уже разобранная до ключа расписания. */
export interface IDigestJob {
  botId: string;
  telegramUserId: string;
  reportKey: string;
  /** «ЧЧ:ММ» из cron; null, если выражение нестандартное. */
  time: string | null;
  cron: string;
  tz: string;
  /** Момент следующего запуска, мс epoch. */
  next: number;
}

export interface IQueueJobRow {
  id: string;
  /** Очередь и состояние — в самой строке: выдача бывает сводной по всем. */
  queue: string;
  state: TJobState;
  name: string;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  attemptsMade: number;
  failedReason?: string;
  delay?: number;
  /** ТОЛЬКО белый список полей — payload'ы несут botToken. */
  data: Record<string, string | number>;
}

/**
 * Чтение очередей Bull для админ-панели. Инстансы очередей — те же, что
 * крутят процессоры TelegramModule (реэкспорт BullModule): второй Queue на
 * то же имя открыл бы свои соединения с Redis и второе место, где могут
 * разъехаться опции.
 */
@Injectable()
export class QueuesService {
  private readonly queues: Map<string, Queue>;

  constructor(
    @InjectQueue(QUEUE_NAMES.FILE_PROCESSING) fileProcessing: Queue,
    @InjectQueue(QUEUE_NAMES.YANDEX_API) yandexApi: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) notifications: Queue,
    @InjectQueue(QUEUE_NAMES.REPORTS) private readonly reports: Queue,
  ) {
    this.queues = new Map([
      [QUEUE_NAMES.FILE_PROCESSING, fileProcessing],
      [QUEUE_NAMES.YANDEX_API, yandexApi],
      [QUEUE_NAMES.NOTIFICATIONS, notifications],
      [QUEUE_NAMES.REPORTS, this.reports],
    ]);
  }

  /**
   * Счётчики по всем очередям. Помнить при чтении: completed/failed — хвост,
   * а не история, их режут removeOnComplete/removeOnFail из telegram.module.ts.
   */
  async counts(): Promise<IQueueSummary[]> {
    return await Promise.all(
      [...this.queues.entries()].map(async ([name, queue]) => {
        const counts = await queue.getJobCounts();
        return {
          name,
          counts: {
            waiting: counts.waiting,
            active: counts.active,
            completed: counts.completed,
            failed: counts.failed,
            delayed: counts.delayed,
          },
        };
      }),
    );
  }

  /** Запланированные рассылки — repeatable-задачи очереди reports. */
  async digests(): Promise<IDigestJob[]> {
    const jobs = await this.reports.getRepeatableJobs();
    const rows: IDigestJob[] = [];

    for (const job of jobs) {
      const parsed = parseReportJobId(job.id);
      // Чужой формат — не рассылка; пропускаем строку, а не роняем выдачу.
      if (!parsed) continue;

      rows.push({
        ...parsed,
        time: cronToTime(job.cron),
        cron: job.cron,
        tz: job.tz,
        next: job.next,
      });
    }

    return rows;
  }

  /**
   * Задачи по нескольким очередям и состояниям сразу — под фильтр «Все».
   *
   * Каждая пара (очередь, состояние) запрашивается отдельно, а не одним
   * getJobs со списком состояний: только так у строки известно её состояние
   * без job.getState() на каждую задачу (это поход в Redis за строку).
   *
   * Страница собирается слиянием: из каждой пары берётся её верх до
   * skip+limit, всё сортируется по времени создания и режется уже у нас.
   * Это корректно, пока каждый источник отдал свои первые skip+limit задач,
   * и дёшево, потому что списки короткие по построению (removeOnComplete).
   */
  async jobs(
    names: string[],
    states: TJobState[],
    { limit, skip }: { limit: number; skip: number },
  ): Promise<{ total: number; items: IQueueJobRow[] }> {
    const pairs = names.flatMap((name) => states.map((state) => ({ name, state })));

    const results = await Promise.all(
      pairs.map(async ({ name, state }) => {
        const queue = this.queueOf(name);
        // getJobs принимает диапазон ИНДЕКСОВ, включительно с обеих сторон.
        const [jobs, count] = await Promise.all([
          queue.getJobs([state], 0, skip + limit - 1),
          queue.getJobCountByTypes(state),
        ]);
        return { name, state, jobs, count };
      }),
    );

    const items = results
      .flatMap(({ name, state, jobs }) =>
        jobs
          // Задача, удалённая между сканом индекса и чтением, приходит как null.
          .filter((job) => !!job)
          .map((job) => ({
            id: String(job.id),
            queue: name,
            state,
            name: job.name,
            timestamp: job.timestamp,
            processedOn: job.processedOn ?? null,
            finishedOn: job.finishedOn ?? null,
            attemptsMade: job.attemptsMade,
            failedReason: (job as { failedReason?: string }).failedReason,
            delay: job.opts.delay,
            data: safeJobData(job.data),
          })),
      )
      // Порядок getJobs у Bull различается по состояниям; сортировка по
      // времени создания делает сводную выдачу единообразной.
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(skip, skip + limit);

    return {
      // Число, а не объект: Bull типизирует getJobCountByTypes как number.
      total: results.reduce((sum, { count }) => sum + count, 0),
      items,
    };
  }

  /**
   * Повторить упавшую задачу. Только упавшую: retry() на живой задаче — это
   * второй запуск того же действия, а delayed-инстанс рассылки перезапустится
   * сам по расписанию.
   */
  async retry(name: string, id: string): Promise<{ ok: true }> {
    const queue = this.queueOf(name);

    const job = await queue.getJob(id);
    if (!job) throw new NotFoundException('Задача не найдена — возможно, её уже вычистил Redis');

    const state = await job.getState();
    if (state !== 'failed') {
      throw new BadRequestException(`Повторить можно только упавшую задачу, эта — «${state}»`);
    }

    await job.retry();
    return { ok: true };
  }

  private queueOf(name: string): Queue {
    const queue = this.queues.get(name);
    // Контроллер валидирует имя раньше; здесь страховка от нового вызова мимо него.
    if (!queue) throw new BadRequestException(`Неизвестная очередь: ${name}`);
    return queue;
  }
}
