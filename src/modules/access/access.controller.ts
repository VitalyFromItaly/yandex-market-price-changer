import type { UserAccessDocument } from '../../database/schemas/user-access.schema';
import type { ICrmAccountState } from '../crm/crm-auth.service';
import type { TFeatureKey } from '../telegram/bots/shared/features.domain';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ActionLogService } from '../../database/services/action-log.service';
import { CostHistoryService } from '../../database/services/cost-history.service';
import { PurchasePriceService } from '../../database/services/purchase-price.service';
import { ReportScheduleService } from '../../database/services/report-schedule.service';
import { UserAccessService } from '../../database/services/user-access.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { CrmAuthService } from '../crm/crm-auth.service';
import { ProductMatchService } from '../products/product-match.service';
import {
  FEATURE,
  FEATURE_KEYS,
  FEATURE_META,
  isFeatureKey,
  resolveFeatureFlags,
  resolveFeatures,
} from '../telegram/bots/shared/features.domain';
import { FinanceImportScheduler } from '../telegram/queue/services/finance-import.scheduler';
import { SellerNotificationsScheduler } from '../telegram/queue/services/seller-notifications.scheduler';
import { StockPushScheduler } from '../telegram/queue/services/stock-push.scheduler';
import { WeeklyDigestScheduler } from '../telegram/queue/services/weekly-digest.scheduler';

import { AccessNotifierService } from './access-notifier.service';

/** `kind` строки журнала о сбросе пароля CRM из панели. */
export const CRM_PASSWORD_RESET_KIND = 'crm-password-reset';
/** Строка журнала «админ вошёл в CRM за продавца». */
export const CRM_IMPERSONATE_KIND = 'crm-impersonate';

/** Строка таблицы пользователей в панели. */
interface IUserRow {
  telegramUserId: string;
  botId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  status: string;
  storeName?: string;
  configured: boolean;
  /** Собственные флаги — то, что ставит тумблер (без зависимостей). */
  features: Record<TFeatureKey, boolean>;
  /** Действующие значения: флаг И все `requires` — то, что видит продавец. */
  effectiveFeatures: Record<TFeatureKey, boolean>;
  createdAt?: Date;
  /**
   * Учётка CRM — только в ответах об одном продавце (карточка): списку пришлось
   * бы делать пакетный запрос ради колонки, которой в нём нет. `null` — в CRM
   * не входил.
   */
  crm?: ICrmAccountState | null;
}

/**
 * Управление пофичным доступом из веб-панели.
 *
 * Весь контроллер закрыт AdminJwtGuard, а не отдельные методы: незакрытым
 * останется ровно тот метод, который забудут пометить — та же причина, что
 * записана у LogsController.
 *
 * Полный адрес — /api/access (глобальный префикс задан в main.ts).
 */
@Controller('access')
@UseGuards(AdminJwtGuard)
export class AccessController {
  // max-params отключено осознанно: панель доступа — точка, где сходятся доступ,
  // CRM, журнал и расписания (финансы, уведомления, ИИ-сводка), которые она пересверяет.
  // eslint-disable-next-line max-params
  constructor(
    private readonly access: UserAccessService,
    private readonly stores: YandexMarketService,
    private readonly prices: PurchasePriceService,
    private readonly products: ProductMatchService,
    private readonly costHistory: CostHistoryService,
    private readonly schedules: ReportScheduleService,
    private readonly notifier: AccessNotifierService,
    private readonly crmAuth: CrmAuthService,
    private readonly actionLog: ActionLogService,
    private readonly financeSchedule: FinanceImportScheduler,
    private readonly notificationsSchedule: SellerNotificationsScheduler,
    private readonly digestSchedule: WeeklyDigestScheduler,
    private readonly pushSchedule: StockPushScheduler,
  ) {}

  /**
   * Реестр возможностей. Панель берёт подписи отсюда и не хранит вторую копию:
   * разъехавшиеся списки подписей — беда, ради которой в этом проекте появился
   * menu.constants.ts.
   */
  @Get('features')
  features() {
    return {
      items: FEATURE_KEYS.map((key) => ({
        key,
        label: FEATURE_META[key].label,
        description: FEATURE_META[key].description,
        defaultEnabled: FEATURE_META[key].defaultEnabled,
        requires: [...(FEATURE_META[key].requires ?? [])],
      })),
    };
  }

  @Get('users')
  async users(@Query('botId') botId?: string) {
    const users = await this.access.list(botId);

    // Магазины — ОДНИМ запросом на всех. Проверять «настроен ли» в цикле, как
    // это делает список в Telegram, значило бы запрос на каждую строку.
    const stores = await this.stores.findByTelegramUsers(users.map((u) => u.telegramUserId));
    const byUser = new Map(stores.map((store) => [store.telegramUserId, store]));

    return { total: users.length, items: users.map((user) => this.rowOf(user, byUser)) };
  }

  /**
   * Открыть или закрыть одну возможность.
   *
   * Ключ проверяется по реестру: он приходит из браузера и попадает в путь
   * `$set`. Значение — строго boolean: `enabled: "false"` строкой записалось бы
   * как истина и закрытая фича осталась бы открытой.
   */
  @Patch('users/:telegramUserId/features')
  async setFeature(
    @Param('telegramUserId') telegramUserId: string,
    @Body() body: { botId?: string; feature?: string; enabled?: boolean },
  ) {
    if (!isFeatureKey(body?.feature)) {
      throw new BadRequestException(`feature: ожидается одно из ${FEATURE_KEYS.join(', ')}`);
    }
    if (typeof body.enabled !== 'boolean') {
      throw new BadRequestException('enabled: ожидается true или false');
    }
    if (!body.botId) {
      throw new BadRequestException('botId: обязателен — запись доступа уникальна парой с ним');
    }

    const updated = await this.access.setFeature(
      telegramUserId,
      body.botId,
      body.feature,
      body.enabled,
    );

    if (!updated) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Фича `finance` — это расписание загрузки: открыли — задача заводится
    // сейчас, а не после рестарта. `refresh` не бросает и не ждётся.
    if (body.feature === FEATURE.FINANCE) void this.financeSchedule.refresh();
    // Проверка уведомлений — тоже расписание; `notifications` требует `finance`.
    if (body.feature === FEATURE.FINANCE || body.feature === FEATURE.NOTIFICATIONS) {
      void this.notificationsSchedule.refresh();
    }
    // ИИ-сводка недели — расписание; `ai_weekly_digest` требует `ai` и `finance`.
    const digestKeys: string[] = [FEATURE.AI_WEEKLY_DIGEST, FEATURE.AI, FEATURE.FINANCE];
    if (digestKeys.includes(body.feature)) void this.digestSchedule.refresh();
    // «Передача остатков» по расписанию: нужна сама фича и хоть одна запись площадки.
    const pushKeys: string[] = [
      FEATURE.STOCK_PUSH_SCHEDULE,
      FEATURE.STOCK_PUSH,
      FEATURE.STOCK_PUSH_WRITE_YM,
      FEATURE.STOCK_PUSH_WRITE_OZON,
      FEATURE.STOCK_PUSH_WRITE_WB,
      FEATURE.OZON,
      FEATURE.WB,
    ];
    if (pushKeys.includes(body.feature)) void this.pushSchedule.refresh();

    return await this.withStore(updated);
  }

  /**
   * Один продавец — для его карточки.
   *
   * Отдельный метод, а не поиск в общем списке на стороне браузера: по адресу
   * карточки заходят напрямую (закладка, обновление страницы), и тянуть ради
   * одной строки выдачу по всем продавцам — лишняя работа на каждом открытии.
   */
  @Get('users/:telegramUserId')
  async user(@Param('telegramUserId') telegramUserId: string, @Query('botId') botId: string) {
    if (!botId) {
      throw new BadRequestException('botId: обязателен — запись доступа уникальна парой с ним');
    }

    const user = await this.access.findByUserAndBot(telegramUserId, botId);
    if (!user) throw new NotFoundException('Пользователь не найден');

    return await this.withStore(user);
  }

  /**
   * Открыть или закрыть доступ — тумблер на карточке продавца.
   *
   * `approved` строго boolean по той же причине, что и у флага возможности:
   * строка `"false"` истинна, и закрытие доступа молча стало бы открытием.
   *
   * Кто нажал — берётся из токена (`req.adminId`, кладёт `AdminJwtGuard`), а не
   * из тела запроса: иначе решение можно было бы подписать чужим именем.
   */
  @Patch('users/:telegramUserId/status')
  async setStatus(
    @Param('telegramUserId') telegramUserId: string,
    @Body() body: { botId?: string; approved?: boolean },
    @Req() req: { adminId?: string },
  ) {
    if (typeof body?.approved !== 'boolean') {
      throw new BadRequestException('approved: ожидается true или false');
    }
    if (!body.botId) {
      throw new BadRequestException('botId: обязателен — запись доступа уникальна парой с ним');
    }

    const updated = await this.access.setApproved(telegramUserId, body.botId, body.approved, {
      id: req.adminId ?? 'panel',
    });

    if (!updated) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Уведомление НЕ ожидается ответом: статус уже записан, и недоступный
    // телеграм не повод отвечать панели «не получилось». Сервис не бросает.
    void this.notifier.notify(updated, body.approved);
    // Закрытый доступ снимает и ночную загрузку финансов (открытый — заводит,
    // если фича открыта).
    void this.financeSchedule.refresh();
    void this.notificationsSchedule.refresh();
    void this.digestSchedule.refresh();
    void this.pushSchedule.refresh();

    return await this.withStore(updated);
  }

  /**
   * Сбросить пароль CRM — кнопка на карточке продавца (после подтверждения).
   *
   * Стартовый пароль, обязательная смена, все сессии продавца в CRM гаснут на
   * следующем запросе (сдвиг `pwdv`, см. CrmAuthService.resetPassword). Пароль в
   * ответе не возвращается: стартовый админ знает, а сменённый не знает никто.
   *
   * Кто нажал — из токена (`req.adminId`), как у тумблера доступа. Решение
   * пишется строкой журнала: «кто сбросил» иначе не восстановить.
   */
  @Post('users/:telegramUserId/crm-password-reset')
  @HttpCode(HttpStatus.OK)
  async resetCrmPassword(
    @Param('telegramUserId') telegramUserId: string,
    @Req() req: { adminId?: string },
  ): Promise<{ crm: ICrmAccountState }> {
    const crm = await this.crmAuth.resetPassword(telegramUserId);
    const adminId = req.adminId ?? 'panel';

    void this.actionLog.record({
      telegramUserId,
      botId: 'crm',
      kind: CRM_PASSWORD_RESET_KIND,
      action: `Сброс пароля CRM администратором ${adminId}`,
      source: 'crm',
      context: `admin:${adminId}`,
    });

    return { crm };
  }

  /**
   * Войти в CRM за продавца — кнопка на карточке продавца (после подтверждения).
   *
   * Выдаёт короткоживущий токен CRM на продавца с отметкой админа (`imp`): CRM
   * видит ровно то, что видит продавец (его фичи, его магазины), с полными
   * правами — решение владельца 2026-10-18. Каждый запрос в этом режиме ложится
   * в журнал строкой продавца с `context: impersonated-by:<админ>`, а сам вход —
   * отдельной строкой ниже. Токен уходит только в ответ панели, в журнал — нет.
   */
  @Post('users/:telegramUserId/crm-impersonate')
  @HttpCode(HttpStatus.OK)
  async impersonateCrm(
    @Param('telegramUserId') telegramUserId: string,
    @Req() req: { adminId?: string },
  ): Promise<{ token: string }> {
    if (!req.adminId) throw new BadRequestException('Не удалось определить администратора');
    const { token } = await this.crmAuth.impersonate(req.adminId, telegramUserId);

    void this.actionLog.record({
      telegramUserId,
      botId: 'crm',
      kind: CRM_IMPERSONATE_KIND,
      action: `Вход в CRM за продавца: администратор ${req.adminId}`,
      source: 'crm',
      context: `admin:${req.adminId}`,
    });

    return { token };
  }

  /**
   * Полностью удалить пользователя — кнопка «Удалить» на карточке продавца.
   *
   * Стираем запись доступа И связанные с продавцом данные: магазин (токен),
   * закупочные цены, товары и расписания рассылки. Журнал действий (`actionlogs`) НЕ
   * трогаем — это аудит, секреты в нём замаскированы, а TTL сам его чистит.
   *
   * После удаления продавец может зарегистрироваться заново: следующий `/start`
   * пересоздаёт свежую запись `new`, а мастер перезапишет остаточный магазин
   * (но мы его всё равно чистим — «удалить» значит удалить).
   *
   * Продавцу НЕ шлём уведомление, в отличие от закрытия доступа: удаление —
   * административная уборка, а «вас удалили» продавцу бессмысленно (он просто
   * пройдёт регистрацию снова).
   */
  @Delete('users/:telegramUserId')
  async remove(
    @Param('telegramUserId') telegramUserId: string,
    @Query('botId') botId: string,
  ): Promise<{ ok: true }> {
    if (!botId) {
      throw new BadRequestException('botId: обязателен — запись доступа уникальна парой с ним');
    }

    // Сначала запись доступа: её отсутствие — это 404, а не «удалили пустоту».
    const existed = await this.access.deleteByUserAndBot(telegramUserId, botId);
    if (!existed) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Остальные данные — идемпотентно (deleteMany по отсутствующему вернёт 0),
    // одним заходом: между собой они не зависят.
    await Promise.all([
      this.stores.deleteByTelegramUser(telegramUserId),
      this.prices.deleteForUser(telegramUserId),
      this.products.deleteForUser(telegramUserId),
      this.costHistory.deleteForUser(telegramUserId),
      this.schedules.deleteForUser(telegramUserId, botId),
    ]);

    return { ok: true };
  }

  /** Одна строка вместе с её магазином — для методов, отдающих одного продавца. */
  private async withStore(user: UserAccessDocument): Promise<IUserRow> {
    const [store, crm] = await Promise.all([
      this.stores.findByTelegramUser(user.telegramUserId),
      this.crmAuth.crmState(user.telegramUserId),
    ]);
    return {
      ...this.rowOf(user, new Map(store ? [[user.telegramUserId, store]] : [])),
      crm,
    };
  }

  /**
   * Идентификаторов магазина в ответе нет намеренно: правило «campaign_id и
   * business_id не показываются» держится и здесь, а читателю-администратору
   * достаточно названия.
   */
  private rowOf(
    user: UserAccessDocument,
    stores: Map<string, { name?: string; campaign_id?: string; business_id?: string }>,
  ): IUserRow {
    const store = stores.get(user.telegramUserId);
    return {
      telegramUserId: user.telegramUserId,
      botId: user.botId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      storeName: store?.name,
      configured: !!(store?.campaign_id && store?.business_id),
      features: resolveFeatureFlags(user.features),
      effectiveFeatures: resolveFeatures(user.features),
      createdAt: user.createdAt,
    };
  }
}
