import type { IQueueJobRow } from './queues.service';

import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UserAccessService } from '../../database/services/user-access.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';

import {
  FILTER_ALL,
  isJobState,
  isQueueName,
  JOB_STATES,
  QUEUE_LIST,
  reportTitleOf,
  userIdOf,
} from './queues.domain';
import { QueuesService } from './queues.service';

/** Строка задачи для панели: безопасный payload плюс расшифровка «чья она». */
interface IQueueJobWithUser extends IQueueJobRow {
  telegramUserId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/** Потолок выдачи задач: списки короткие по построению (removeOnComplete). */
const MAX_JOBS_PAGE = 100;
const DEFAULT_JOBS_PAGE = 50;

/**
 * Чтение очередей Bull из веб-панели. Только для администраторов — весь
 * контроллер закрыт AdminJwtGuard, а не отдельные методы: незакрытым
 * останется ровно тот метод, который забудут пометить (правило LogsController).
 *
 * Полный адрес — /api/queues (глобальный префикс задан в main.ts).
 */
@Controller('queues')
@UseGuards(AdminJwtGuard)
export class QueuesController {
  constructor(
    private readonly queues: QueuesService,
    private readonly access: UserAccessService,
    private readonly stores: YandexMarketService,
  ) {}

  @Get()
  async counts() {
    return { items: await this.queues.counts() };
  }

  /**
   * Запланированные рассылки с расшифровкой «кто и какой отчёт».
   *
   * Обогащение — батчем, как в AccessController.users(): один запрос записей
   * доступа и один запрос магазинов на всю выдачу, а не по строке.
   */
  @Get('digests')
  async digests() {
    const jobs = await this.queues.digests();

    const [users, stores] = await Promise.all([
      this.access.list(),
      this.stores.findByTelegramUsers([...new Set(jobs.map((job) => job.telegramUserId))]),
    ]);
    const userBy = new Map(users.map((user) => [`${user.botId}:${user.telegramUserId}`, user]));
    const storeBy = new Map(stores.map((store) => [store.telegramUserId, store]));

    return {
      items: jobs.map((job) => {
        const user = userBy.get(`${job.botId}:${job.telegramUserId}`);
        const store = storeBy.get(job.telegramUserId);
        // Идентификаторы магазина в ответ не попадают — правило «campaign_id
        // и business_id не показываются» держится и здесь, имени достаточно.
        return {
          ...job,
          reportTitle: reportTitleOf(job.reportKey),
          username: user?.username,
          firstName: user?.firstName,
          lastName: user?.lastName,
          storeName: store?.name,
        };
      }),
    };
  }

  /**
   * Задачи очереди по состоянию. И очередь, и состояние принимают `all`;
   * состояние по умолчанию — все: страница открывается сводной картиной,
   * а не одним срезом.
   */
  @Get(':name/jobs')
  async jobs(
    @Param('name') name: string,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    let names: string[];
    if (name === FILTER_ALL) {
      names = [...QUEUE_LIST];
    } else {
      this.assertQueueName(name);
      names = [name];
    }

    const stateFilter = state ?? FILTER_ALL;
    if (stateFilter !== FILTER_ALL && !isJobState(stateFilter)) {
      throw new BadRequestException(
        `state: ожидается ${FILTER_ALL} или одно из ${JOB_STATES.join(', ')}`,
      );
    }
    const states = stateFilter === FILTER_ALL ? [...JOB_STATES] : [stateFilter];

    const page = {
      limit: Math.min(this.numberOf(limit, 'limit') ?? DEFAULT_JOBS_PAGE, MAX_JOBS_PAGE),
      skip: this.numberOf(skip, 'skip') ?? 0,
    };

    const { total, items } = await this.queues.jobs(names, states, page);
    return { total, limit: page.limit, skip: page.skip, items: await this.withUsers(items) };
  }

  /**
   * Ники к задачам — тем же батчем, что в digests(): один запрос записей
   * доступа на всю страницу. Без этого в панели видно только числовой id из
   * payload'а, и понять, чья это загрузка, нельзя.
   */
  private async withUsers(jobs: IQueueJobRow[]): Promise<IQueueJobWithUser[]> {
    const withUser = jobs.map((job) => ({ job, telegramUserId: userIdOf(job.data) }));
    // Задач без пользователя (например, служебных) хватает, а список задач
    // панель опрашивает каждые 10 секунд — лишний запрос в Mongo не нужен.
    if (!withUser.some((row) => row.telegramUserId)) return jobs;

    const users = await this.access.list();
    const byBot = new Map(users.map((user) => [`${user.botId}:${user.telegramUserId}`, user]));
    // Запасная карта: часть payload'ов botId не несёт. Один и тот же
    // telegramUserId у разных ботов — это один аккаунт Telegram, ник у него
    // общий, поэтому годится любая запись.
    const byUser = new Map(users.map((user) => [user.telegramUserId, user]));

    return withUser.map(({ job, telegramUserId }) => {
      if (!telegramUserId) return job;

      const user = byBot.get(`${job.data.botId}:${telegramUserId}`) ?? byUser.get(telegramUserId);
      return {
        ...job,
        telegramUserId,
        username: user?.username,
        firstName: user?.firstName,
        lastName: user?.lastName,
      };
    });
  }

  @Post(':name/jobs/:id/retry')
  async retry(@Param('name') name: string, @Param('id') id: string) {
    this.assertQueueName(name);
    return await this.queues.retry(name, id);
  }

  /** Имя очереди приходит из браузера — только по белому списку. */
  private assertQueueName(name: string): void {
    if (!isQueueName(name)) {
      throw new BadRequestException(`Неизвестная очередь. Ожидается: ${QUEUE_LIST.join(', ')}`);
    }
  }

  private numberOf(value: string | undefined, field: string): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`${field}: ожидается целое неотрицательное число`);
    }
    return parsed;
  }
}
