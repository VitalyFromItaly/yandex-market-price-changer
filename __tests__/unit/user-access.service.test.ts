import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { UserAccess } from '../../src/database/schemas/user-access.schema';

/**
 * Проверяются ФИЛЬТРЫ запросов, а не возвращаемые значения.
 *
 * Именно ожидаемый статус в фильтре обеспечивает «первое решение побеждает» и
 * идемпотентность заявки. Система типов его не контролирует: пропавшее условие
 * не даёт ни ошибки компиляции, ни падения — просто двое администраторов
 * успешно решают одну заявку, а пользователь получает две карточки. Обнаружить
 * это можно только в проде или вот таким тестом.
 */
describe('UserAccessService: атомарность переходов', () => {
  let findOneAndUpdate: ReturnType<typeof vi.fn>;
  let updateOne: ReturnType<typeof vi.fn>;
  let service: UserAccessService;

  const exec = <T>(value: T) => ({ exec: async () => value });

  beforeEach(async () => {
    findOneAndUpdate = vi.fn(() => exec({ status: 'new' }));
    updateOne = vi.fn(() => exec({ acknowledged: true }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserAccessService,
        {
          provide: getModelToken(UserAccess.name),
          useValue: { findOneAndUpdate, updateOne, findOne: () => exec(null) },
        },
      ],
    }).compile();

    service = moduleRef.get(UserAccessService);
  });

  const [filter, update, options] = [0, 1, 2];
  const call = (n = 0) => findOneAndUpdate.mock.calls[n];

  it('ensure — настоящий upsert, а не find-then-create', async () => {
    // find-then-create создаёт второй документ, если два сообщения от одного
    // пользователя обрабатываются параллельно (так устроен upsertByTelegramUser
    // у YandexMarket).
    await service.ensure({ telegramUserId: '1', botId: '2', telegramChatId: '3' });

    expect(call()[options]).toMatchObject({ upsert: true });
    expect(call()[update]).toHaveProperty('$setOnInsert.status', 'new');
    // Статус выставляется ТОЛЬКО при вставке: иначе повторный вход одобренного
    // пользователя сбрасывал бы его в new.
    expect(call()[update].$set).not.toHaveProperty('status');
  });

  it('tryApply переводит только из new — на этом держится идемпотентность заявки', async () => {
    await service.tryApply('1', '2');
    expect(call()[filter]).toMatchObject({
      telegramUserId: '1',
      botId: '2',
      status: 'new',
    });
    expect(call()[update].$set).toMatchObject({ status: 'pending' });
    expect(call()[update].$unset).toHaveProperty('draft');
  });

  it('decide переводит только из pending — второе нажатие получит null', async () => {
    await service.decide('1', '2', 'approve', { id: '77', username: 'admin' });
    expect(call()[filter]).toMatchObject({ status: 'pending' });
    expect(call()[update].$set).toMatchObject({
      status: 'approved',
      decidedBy: '77',
      decidedByUsername: 'admin',
    });
  });

  it('reject проставляет rejectedAt — от него отсчитываются сутки запрета', async () => {
    await service.decide('1', '2', 'reject', { id: '77' });
    expect(call()[update].$set).toMatchObject({ status: 'rejected' });
    expect(call()[update].$set.rejectedAt).toBeInstanceOf(Date);
  });

  it('revertApply возвращает в new только из pending', async () => {
    await service.revertApply('1', '2');
    expect(call()[filter]).toMatchObject({ status: 'pending' });
    expect(call()[update].$set).toMatchObject({ status: 'new' });
  });

  it('expireRejection перепроверяет срок В ФИЛЬТРЕ — иначе два апдейта сбросят статус дважды', async () => {
    const cutoff = new Date('2026-07-27T12:00:00Z');
    await service.expireRejection('1', '2', cutoff);

    expect(call()[filter]).toMatchObject({ status: 'rejected' });
    expect(call()[filter].rejectedAt).toEqual({ $lte: cutoff });
    expect(call()[update].$set).toMatchObject({ status: 'new' });
    // Следы прошлого отказа должны исчезнуть, иначе они мешают новому циклу.
    for (const field of ['rejectedAt', 'decidedBy', 'draft', 'adminCards']) {
      expect(call()[update].$unset).toHaveProperty(field);
    }
  });

  it('saveDraftField пишет только в разрешённые поля черновика', async () => {
    // Имя поля попадает в ключ $set, поэтому пользовательский ввод сюда
    // попадать не должен ни при каких обстоятельствах.
    await service.saveDraftField('1', '2', 'token', 'ACMA:xxx');
    expect(call()[update].$set).toEqual({ 'draft.token': 'ACMA:xxx' });

    await expect(service.saveDraftField('1', '2', 'status' as never, 'approved')).rejects.toThrow();
  });

  it('grant выдаёт доступ без заявки — для администратора-продавца', async () => {
    await service.grant({ telegramUserId: '1', botId: '2', telegramChatId: '3' });
    expect(call()[update].$set).toMatchObject({ status: 'approved' });
    expect(call()[options]).toMatchObject({ upsert: true });
  });

  it('все запросы скоупятся по паре (пользователь × бот)', async () => {
    // Мультитенантность: кред одного продавца не должен утечь другому.
    await service.tryApply('1', '2');
    await service.decide('1', '2', 'approve', { id: '77' });
    await service.revertApply('1', '2');
    await service.expireRejection('1', '2', new Date());

    for (const c of findOneAndUpdate.mock.calls) {
      expect(c[filter]).toMatchObject({ telegramUserId: '1', botId: '2' });
    }
  });
});
