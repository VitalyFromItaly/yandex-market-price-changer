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

import { FinanceDiscrepancyRepository } from '../../database/postgres/repositories/finance-discrepancy.repository';
import { FinancePeriodRepository } from '../../database/postgres/repositories/finance-period.repository';
import { ActionLogService } from '../../database/services/action-log.service';
import { UserAccessService } from '../../database/services/user-access.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { FINANCE_PERIOD_STATUS_LABEL } from '../finance/finance-period-status';
import { STOCK_PUSH_SCHEDULE_LOG_KIND } from '../stock-push/stock-push.service';
import { HOSTING_REMINDER_LOG_KIND } from '../telegram/queue/processors/hosting-reminder.processor';
import { WEEKLY_DIGEST_LOG_KIND } from '../telegram/queue/processors/weekly-digest.processor';
import { FinanceImportScheduler } from '../telegram/queue/services/finance-import.scheduler';
import { HostingReminderService } from '../telegram/queue/services/hosting-reminder.service';
import { StockPushScheduler } from '../telegram/queue/services/stock-push.scheduler';
import { WeeklyDigestScheduler } from '../telegram/queue/services/weekly-digest.scheduler';

import {
  FILTER_ALL,
  isJobState,
  isQueueName,
  JOB_STATES,
  QUEUE_LIST,
  cronToTime,
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
    private readonly financeSchedule: FinanceImportScheduler,
    private readonly financePeriods: FinancePeriodRepository,
    private readonly financeDiscrepancies: FinanceDiscrepancyRepository,
    private readonly digestSchedule: WeeklyDigestScheduler,
    private readonly pushSchedule: StockPushScheduler,
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
   * Загрузка финансов по расписанию (TASK-112): кому заведена ночная задача,
   * когда следующая, когда грузили последний раз и чем кончилось, статусы
   * месяцев.
   *
   * Строки — по ЗАВЕДЁННЫМ задачам, а не по флагам в Mongo: карточка отвечает
   * «что на самом деле стоит в Redis», и расхождение со списком в доступе —
   * ровно то, что админ должен увидеть. Статусы из Postgres берутся отдельно и
   * падение базы карточку не роняет: расписание живёт в Redis и видно и так.
   */
  @Get('finance-import')
  async financeImportCard() {
    const jobs = await this.financeSchedule.jobs();
    const ids = [...new Set(jobs.map((job) => job.telegramUserId))];

    let periods: Awaited<ReturnType<FinancePeriodRepository['listByUsers']>> = [];
    let actMismatches: Awaited<ReturnType<FinanceDiscrepancyRepository['listByKind']>> = [];
    let periodsError: string | null = null;
    try {
      [periods, actMismatches] = await Promise.all([
        this.financePeriods.listByUsers(ids),
        // Какой акт не сошёлся с отчётом услуг (TASK-158) — строкой под статусом.
        this.financeDiscrepancies.listByKind(ids, 'act_mismatch'),
      ]);
    } catch (error) {
      periodsError = (error as Error)?.message ?? String(error);
    }
    const actsBy = new Map<string, string[]>();
    for (const f of actMismatches) {
      const key = `${f.telegramUserId}:${f.periodKey}`;
      actsBy.set(key, [...(actsBy.get(key) ?? []), f.detail]);
    }

    const [users, stores] = ids.length
      ? await Promise.all([this.access.list(), this.stores.findByTelegramUsers(ids)])
      : [[], []];
    // Ключ — только telegramUserId: задача загрузки не знает бота (журнал
    // ключуется продавцом), у админа записи доступа нет вовсе.
    const userBy = new Map(users.map((user) => [user.telegramUserId, user]));
    const storeBy = new Map(stores.map((store) => [store.telegramUserId, store]));

    return {
      periodsError,
      items: jobs.map((job) => {
        const user = userBy.get(job.telegramUserId);
        const own = periods.filter((p) => p.telegramUserId === job.telegramUserId);
        // Последняя загрузка — по самому свежему периоду: ночной проход
        // пишет каждый месяц отдельно.
        const last = own.reduce<(typeof own)[number] | null>(
          (max, p) => (!max || p.checkedAt > max.checkedAt ? p : max),
          null,
        );
        return {
          telegramUserId: job.telegramUserId,
          username: user?.username,
          firstName: user?.firstName,
          lastName: user?.lastName,
          // Идентификаторы магазина в ответ не попадают — правило панели.
          storeName: storeBy.get(job.telegramUserId)?.name,
          time: cronToTime(job.cron),
          tz: job.tz,
          next: job.next,
          last: last ? { at: last.checkedAt, outcome: last.lastOutcome } : null,
          periods: own.map((p) => ({
            periodFrom: p.periodFrom,
            periodTo: p.periodTo,
            status: p.status,
            statusLabel: FINANCE_PERIOD_STATUS_LABEL[p.status],
            lastOutcome: p.lastOutcome,
            documentVersion: p.documentVersion,
            unknownCount: p.unknownCount,
            changedCount: p.changedCount,
            removedCount: p.removedCount,
            discrepancyCount: p.discrepancyCount,
            reconcileState: p.reconcileState,
            reconcileNote: p.reconcileNote,
            actMismatches: actsBy.get(`${p.telegramUserId}:${p.periodKey}`) ?? [],
            error: p.error,
            checkedAt: p.checkedAt,
          })),
        };
      }),
    };
  }

  /**
   * ИИ-сводка недели (TASK-168): кому заведена задача, когда следующая и чем
   * кончился последний запуск — строкой журнала процессора («отправлено 1 из 1»,
   * «пропущено: нет данных», «лимит ИИ»). Без неё на вопрос «ушла ли сводка»
   * отвечал бы только продавец (урок hosting-reminder).
   *
   * Строки — по ЗАВЕДЁННЫМ задачам (довод `financeImportCard`).
   */
  @Get('weekly-digest')
  async weeklyDigestCard() {
    return {
      items: await this.scheduleRows(await this.digestSchedule.jobs(), WEEKLY_DIGEST_LOG_KIND),
    };
  }

  /**
   * «Передача остатков» по расписанию (TASK-176): кому заведён проход, когда
   * следующий и итог последнего — строкой журнала прохода («записано 3 из 3»,
   * «Ozon: несколько складов…»). Строки — по ЗАВЕДЁННЫМ задачам (довод
   * `financeImportCard`).
   */
  @Get('stock-push-schedule')
  async stockPushScheduleCard() {
    return {
      items: await this.scheduleRows(await this.pushSchedule.jobs(), STOCK_PUSH_SCHEDULE_LOG_KIND),
    };
  }

  /**
   * Проход «Передачи остатков» прямо сейчас — реальная запись на площадки.
   * Право перепроверяет процессор тем же правилом, что расписание: без фичи
   * расписания и записи проход только оставит строку «пропущено».
   */
  @Post('stock-push-schedule/:telegramUserId/run')
  async runStockPushSchedule(@Param('telegramUserId') telegramUserId: string) {
    if (!/^\d+$/.test(telegramUserId)) throw new BadRequestException('telegramUserId — число');
    await this.pushSchedule.sendNow(telegramUserId);
    return { queued: true };
  }

  /**
   * Строки карточки расписания на продавца: кто, магазин, cron, следующий
   * запуск и последняя строка журнала своего kind.
   */
  private async scheduleRows(
    jobs: { telegramUserId: string; cron: string; tz: string; next: number }[],
    logKind: string,
  ) {
    const ids = [...new Set(jobs.map((job) => job.telegramUserId))];
    const [users, stores, runs] = ids.length
      ? await Promise.all([
          this.access.list(),
          this.stores.findByTelegramUsers(ids),
          // Свежие сверху: первая строка продавца — его последний запуск.
          this.actionLog.list({ kind: logKind, limit: 200 }),
        ])
      : [[], [], []];
    const userBy = new Map(users.map((user) => [user.telegramUserId, user]));
    const storeBy = new Map(stores.map((store) => [store.telegramUserId, store]));
    const lastBy = new Map<string, (typeof runs)[number]>();
    for (const run of runs)
      if (!lastBy.has(run.telegramUserId)) lastBy.set(run.telegramUserId, run);

    return jobs.map((job) => {
      const user = userBy.get(job.telegramUserId);
      const last = lastBy.get(job.telegramUserId);
      return {
        telegramUserId: job.telegramUserId,
        username: user?.username,
        firstName: user?.firstName,
        lastName: user?.lastName,
        storeName: storeBy.get(job.telegramUserId)?.name,
        cron: job.cron,
        tz: job.tz,
        next: job.next,
        last: last ? { at: last.createdAt, action: last.action, status: last.status } : null,
      };
    });
  }

  /**
   * Отправить сводку продавцу (или себе, админу) прямо сейчас. Право
   * перепроверяет процессор — тем же правилом, что расписание; админ без
   * строки доступа получает её в личку первого бота.
   */
  @Post('weekly-digest/:telegramUserId/run')
  async runWeeklyDigest(@Param('telegramUserId') telegramUserId: string) {
    if (!/^\d+$/.test(telegramUserId)) throw new BadRequestException('telegramUserId — число');
    await this.digestSchedule.sendNow(telegramUserId);
    return { queued: true };
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
