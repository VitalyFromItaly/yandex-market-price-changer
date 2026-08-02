import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { ReportScheduleService } from '../../src/database/services/report-schedule.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AccessNotifierService } from '../../src/modules/access/access-notifier.service';
import { AccessController } from '../../src/modules/access/access.controller';
import { AdminAuthService } from '../../src/modules/admin/admin-auth.service';
import { AdminJwtGuard } from '../../src/modules/admin/admin-jwt.guard';
import {
  FEATURE,
  FEATURE_KEYS,
} from '../../src/modules/telegram/bots/shared/features.domain';

/**
 * HTTP-поверхность пофичного доступа.
 *
 * Проверяется то, что не ловится ни компилятором, ни ревью: закрыт ли
 * контроллер гвардом, не утекают ли идентификаторы магазина и что происходит
 * с ключом фичи, пришедшим из браузера.
 */
describe('AccessController', () => {
  const USER = {
    telegramUserId: '222',
    botId: '999',
    username: 'vasya',
    firstName: 'Вася',
    status: 'approved',
    features: { [FEATURE.REPORT_PROFIT]: false },
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };

  const STORE = {
    telegramUserId: '222',
    name: 'Всё для часов',
    campaign_id: '12345678',
    business_id: '87654321',
    token: 'ACMA:секрет',
  };

  let list: ReturnType<typeof vi.fn>;
  let setFeature: ReturnType<typeof vi.fn>;
  let setApproved: ReturnType<typeof vi.fn>;
  let findByUserAndBot: ReturnType<typeof vi.fn>;
  let findByTelegramUsers: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;
  let deleteByUserAndBot: ReturnType<typeof vi.fn>;
  let deleteByTelegramUser: ReturnType<typeof vi.fn>;
  let deletePricesForUser: ReturnType<typeof vi.fn>;
  let deleteSchedulesForUser: ReturnType<typeof vi.fn>;
  let controller: AccessController;

  beforeEach(async () => {
    list = vi.fn(async () => [USER]);
    setFeature = vi.fn(async () => ({ ...USER, features: { [FEATURE.REPORT_PROFIT]: true } }));
    setApproved = vi.fn(async () => ({ ...USER, status: 'rejected' }));
    findByUserAndBot = vi.fn(async () => USER);
    findByTelegramUsers = vi.fn(async () => [STORE]);
    findByTelegramUser = vi.fn(async () => STORE);
    notify = vi.fn(async () => undefined);
    deleteByUserAndBot = vi.fn(async () => true);
    deleteByTelegramUser = vi.fn(async () => true);
    deletePricesForUser = vi.fn(async () => 4100);
    deleteSchedulesForUser = vi.fn(async () => 2);

    const moduleRef = await Test.createTestingModule({
      controllers: [AccessController],
      providers: [
        {
          provide: UserAccessService,
          useValue: { list, setFeature, setApproved, findByUserAndBot, deleteByUserAndBot },
        },
        {
          provide: YandexMarketService,
          useValue: { findByTelegramUsers, findByTelegramUser, deleteByTelegramUser },
        },
        { provide: PurchasePriceService, useValue: { deleteForUser: deletePricesForUser } },
        { provide: ReportScheduleService, useValue: { deleteForUser: deleteSchedulesForUser } },
        { provide: AccessNotifierService, useValue: { notify } },
        // Гвард висит на классе, поэтому Nest поднимает его вместе с
        // контроллером. Здесь проверяется НАЛИЧИЕ гварда, а его собственная
        // логика — в admin-auth.test.ts.
        { provide: AdminAuthService, useValue: { verify: async () => '1' } },
      ],
    }).compile();

    controller = moduleRef.get(AccessController);
  });

  it('весь контроллер закрыт гвардом, а не отдельные методы', () => {
    // Незакрытым останется ровно тот метод, который забудут пометить.
    const guards = Reflect.getMetadata('__guards__', AccessController) ?? [];
    expect(guards).toContain(AdminJwtGuard);
  });

  it('реестр возможностей отдаётся целиком', () => {
    const { items } = controller.features();
    expect(items.map((i) => i.key).sort()).toEqual([...FEATURE_KEYS].sort());
    for (const item of items) {
      expect(item.label).toBeTruthy();
      expect(typeof item.defaultEnabled).toBe('boolean');
    }
  });

  it('список отдаёт разрешённые значения ВСЕХ флагов, а не только явные', () => {
    // Панель рисует по столбцу на возможность: пропущенный ключ выглядел бы
    // как выключенная галочка.
    return controller.users().then(({ items }) => {
      expect(Object.keys(items[0].features).sort()).toEqual([...FEATURE_KEYS].sort());
      expect(items[0].features[FEATURE.REPORT_PROFIT]).toBe(false);
      expect(items[0].features[FEATURE.REPORT_REDEEMED]).toBe(true);
    });
  });

  it('магазины запрашиваются ОДНИМ запросом на всех', async () => {
    await controller.users();
    expect(findByTelegramUsers).toHaveBeenCalledTimes(1);
    expect(findByTelegramUsers).toHaveBeenCalledWith(['222']);
  });

  it('идентификаторы магазина и токен в ответ не попадают', async () => {
    // Правило «campaign_id и business_id не показываются» держится и здесь.
    const response = await controller.users();
    const raw = JSON.stringify(response);

    expect(raw).not.toContain('12345678');
    expect(raw).not.toContain('87654321');
    expect(raw).not.toContain('ACMA');
    expect(response.items[0].storeName).toBe('Всё для часов');
    expect(response.items[0].configured).toBe(true);
  });

  it('фильтр по боту передаётся в сервис как есть', async () => {
    await controller.users('999');
    expect(list).toHaveBeenCalledWith('999');
  });

  it('правка флага доходит до сервиса и возвращает новое состояние', async () => {
    const row = await controller.setFeature('222', {
      botId: '999',
      feature: FEATURE.REPORT_PROFIT,
      enabled: true,
    });

    expect(setFeature).toHaveBeenCalledWith('222', '999', FEATURE.REPORT_PROFIT, true);
    expect(row.features[FEATURE.REPORT_PROFIT]).toBe(true);
  });

  it('ключ вне реестра отвергается — он попадает в путь $set', async () => {
    await expect(
      controller.setFeature('222', { botId: '999', feature: 'status', enabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(setFeature).not.toHaveBeenCalled();
  });

  it('enabled строкой отвергается', async () => {
    // `"false"` — истина: закрытая фича осталась бы открытой, и молча.
    await expect(
      controller.setFeature('222', {
        botId: '999',
        feature: FEATURE.SCHEDULE,
        enabled: 'false' as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('без botId правка отвергается — запись уникальна парой с ним', async () => {
    await expect(
      controller.setFeature('222', { feature: FEATURE.SCHEDULE, enabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('неизвестный пользователь — 404, а не молча заведённая запись', async () => {
    setFeature.mockResolvedValueOnce(null);
    await expect(
      controller.setFeature('404', { botId: '999', feature: FEATURE.SCHEDULE, enabled: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('карточка одного продавца', () => {
    it('отдаётся отдельным запросом, без выгрузки всего списка', async () => {
      // По адресу карточки заходят напрямую — закладкой и обновлением
      // страницы. Тянуть ради одной строки выдачу по всем незачем.
      const row = await controller.user('222', '999');

      expect(findByUserAndBot).toHaveBeenCalledWith('222', '999');
      expect(list).not.toHaveBeenCalled();
      expect(row.telegramUserId).toBe('222');
      expect(Object.keys(row.features).sort()).toEqual([...FEATURE_KEYS].sort());
    });

    it('без botId — 400, запись уникальна парой с ним', async () => {
      await expect(controller.user('222', '')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('неизвестный продавец — 404', async () => {
      findByUserAndBot.mockResolvedValueOnce(null);
      await expect(controller.user('404', '999')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('идентификаторы магазина не утекают и здесь', async () => {
      const raw = JSON.stringify(await controller.user('222', '999'));
      expect(raw).not.toContain('12345678');
      expect(raw).not.toContain('ACMA');
    });
  });

  describe('тумблер доступа', () => {
    const req = { adminId: '309809755' };

    it('закрывает доступ и подписывает решение тем, кто вошёл в панель', async () => {
      // Автор решения берётся из токена, а не из тела запроса: иначе его можно
      // было бы подписать чужим именем.
      const row = await controller.setStatus('222', { botId: '999', approved: false }, req);

      expect(setApproved).toHaveBeenCalledWith('222', '999', false, { id: '309809755' });
      expect(row.status).toBe('rejected');
    });

    it('открывает доступ', async () => {
      setApproved.mockResolvedValueOnce({ ...USER, status: 'approved' });
      const row = await controller.setStatus('222', { botId: '999', approved: true }, req);

      expect(setApproved).toHaveBeenCalledWith('222', '999', true, { id: '309809755' });
      expect(row.status).toBe('approved');
    });

    it('продавца уведомляют о смене доступа', async () => {
      // Молчаливое отключение продавец воспримет как поломку бота и придёт
      // разбираться именно как с поломкой — та же причина, что и у отзыва
      // доступа из Telegram.
      await controller.setStatus('222', { botId: '999', approved: false }, req);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }), false);
    });

    it('approved строкой отвергается', async () => {
      // `"false"` — истина: закрытие доступа молча стало бы открытием.
      await expect(
        controller.setStatus('222', { botId: '999', approved: 'false' as never }, req),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(setApproved).not.toHaveBeenCalled();
    });

    it('без botId отвергается', async () => {
      await expect(
        controller.setStatus('222', { approved: true }, req),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('неизвестный пользователь — 404, и уведомления не будет', async () => {
      setApproved.mockResolvedValueOnce(null);
      await expect(
        controller.setStatus('404', { botId: '999', approved: true }, req),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe('удаление пользователя', () => {
    it('стирает доступ И все связанные данные, кроме журнала', async () => {
      const result = await controller.remove('222', '999');

      expect(deleteByUserAndBot).toHaveBeenCalledWith('222', '999');
      expect(deleteByTelegramUser).toHaveBeenCalledWith('222');
      expect(deletePricesForUser).toHaveBeenCalledWith('222');
      // Расписания — по паре с botId, как и запись доступа.
      expect(deleteSchedulesForUser).toHaveBeenCalledWith('222', '999');
      expect(result).toEqual({ ok: true });
    });

    it('без botId отвергается — запись уникальна парой с ним', async () => {
      await expect(controller.remove('222', '')).rejects.toBeInstanceOf(BadRequestException);
      expect(deleteByUserAndBot).not.toHaveBeenCalled();
    });

    it('неизвестный пользователь — 404, и связанные данные не трогаем', async () => {
      // Нечего удалять: запись доступа отсутствует. Иначе панель отрапортовала
      // бы об успешном удалении несуществующего.
      deleteByUserAndBot.mockResolvedValueOnce(false);
      await expect(controller.remove('404', '999')).rejects.toBeInstanceOf(NotFoundException);
      expect(deleteByTelegramUser).not.toHaveBeenCalled();
      expect(deletePricesForUser).not.toHaveBeenCalled();
      expect(deleteSchedulesForUser).not.toHaveBeenCalled();
    });

    it('уведомление продавцу НЕ шлётся — удаление это уборка, а не смена статуса', async () => {
      await controller.remove('222', '999');
      expect(notify).not.toHaveBeenCalled();
    });
  });
});
