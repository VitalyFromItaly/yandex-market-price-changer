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

import { ActionLogService } from '../../database/services/action-log.service';
import { UserAccessService } from '../../database/services/user-access.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { HOSTING_REMINDER_LOG_KIND } from '../telegram/queue/processors/hosting-reminder.processor';
import { HostingReminderService } from '../telegram/queue/services/hosting-reminder.service';

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
    private readonly hostingReminder: HostingReminderService,
    private readonly actionLog: ActionLogService,
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
   * Напоминание об оплате хостинга: заведено ли, когда следующая отправка,
   * кому уйдёт и когда уходило в прошлый раз.
   *
   * Своя ручка, а не строка в `digests()`: та таблица — про персональные
   * рассылки отчётов, у неё колонки «кто» и «какой отчёт», а здесь получателей
   * много и отчёта нет вовсе. Именно поэтому глобальной рассылки в панели до
   * сих пор не было видно: `digests()` молча отбрасывает id чужого формата.
   *
   * Получателей спрашиваем у того же сервиса, что и сама рассылка, — иначе
   * панель показывала бы один список, а сообщения уходили другому.
   */
  @Get('hosting-reminder')
  async hostingReminderCard() {
    const [schedule, recipients, lastRuns] = await Promise.all([
      this.queues.hostingReminder(),
      this.hostingReminder.recipients(),
      this.actionLog.list({ kind: HOSTING_REMINDER_LOG_KIND, limit: 1 }),
    ]);

    // Ники и названия магазинов — тем же батчем, что в digests(): один запрос
    // на всю выдачу, а не по строке.
    const [users, stores] = await Promise.all([
      this.access.list(),
      this.stores.findByTelegramUsers([...new Set(recipients.map((r) => r.telegramUserId))]),
    ]);
    const userBy = new Map(users.map((user) => [`${user.botId}:${user.telegramUserId}`, user]));
    const storeBy = new Map(stores.map((store) => [store.telegramUserId, store]));

    const last = lastRuns[0];

    return {
      // null — задача не заведена: развёрнут код без неё. Это главный
      // диагностический ответ на вопрос «почему ничего не пришло».
      schedule,
      lastRun: last ? { at: last.createdAt, action: last.action, botId: last.botId } : null,
      items: recipients.map((recipient) => {
        const user = userBy.get(`${recipient.botId}:${recipient.telegramUserId}`);
        // Идентификаторы магазина в ответ не попадают — общее правило панели,
        // имени достаточно.
        return {
          botId: recipient.botId,
          telegramUserId: recipient.telegramUserId,
          username: user?.username,
          firstName: user?.firstName,
          lastName: user?.lastName,
          storeName: storeBy.get(recipient.telegramUserId)?.name,
        };
      }),
    };
  }

  /**
   * Разослать напоминание прямо сейчас.
   *
   * Нужна не для удобства: рассылка уходит раз в месяц, и без кнопки убедиться,
   * что она работает, можно было только дождавшись последнего дня месяца.
   * Джоба ставится с `force`, то есть обходит проверку даты — и ТОЛЬКО её:
   * отбор получателей остаётся общим с расписанием.
   *
   * Возвращаем число получателей: панель уже показала его в подтверждении, и
   * расхождение сразу видно.
   */
  @Post('hosting-reminder/run')
  async runHostingReminder() {
    const recipients = await this.hostingReminder.recipients();
    await this.queues.runHostingReminder();
    return { queued: true, recipients: recipients.length };
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
