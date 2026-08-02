import type { UserAccessDocument } from '../../database/schemas/user-access.schema';
import type { TFeatureKey } from '../telegram/bots/shared/features.domain';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { PurchasePriceService } from '../../database/services/purchase-price.service';
import { ReportScheduleService } from '../../database/services/report-schedule.service';
import { UserAccessService } from '../../database/services/user-access.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import {
  FEATURE_KEYS,
  FEATURE_META,
  isFeatureKey,
  resolveFeatures,
} from '../telegram/bots/shared/features.domain';

import { AccessNotifierService } from './access-notifier.service';

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
  features: Record<TFeatureKey, boolean>;
  createdAt?: Date;
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
  constructor(
    private readonly access: UserAccessService,
    private readonly stores: YandexMarketService,
    private readonly prices: PurchasePriceService,
    private readonly schedules: ReportScheduleService,
    private readonly notifier: AccessNotifierService,
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

    return await this.withStore(updated);
  }

  /**
   * Полностью удалить пользователя — кнопка «Удалить» на карточке продавца.
   *
   * Стираем запись доступа И связанные с продавцом данные: магазин (токен),
   * закупочные цены и расписания рассылки. Журнал действий (`actionlogs`) НЕ
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
      this.schedules.deleteForUser(telegramUserId, botId),
    ]);

    return { ok: true };
  }

  /** Одна строка вместе с её магазином — для методов, отдающих одного продавца. */
  private async withStore(user: UserAccessDocument): Promise<IUserRow> {
    const store = await this.stores.findByTelegramUser(user.telegramUserId);
    return this.rowOf(user, new Map(store ? [[user.telegramUserId, store]] : []));
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
      features: resolveFeatures(user.features),
      createdAt: user.createdAt,
    };
  }
}
