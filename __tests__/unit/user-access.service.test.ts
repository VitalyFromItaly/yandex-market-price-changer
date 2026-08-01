import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DRAFT_FIELDS, UserAccessService } from '../../src/database/services/user-access.service';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';

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

  it('store_name — разрешённое поле черновика', async () => {
    // Дефект на память: TASK-052 расширила тип TDraftField полем store_name, а
    // белый список DRAFT_FIELDS забыла. Компилятор промолчал (`TDraftField[]`
    // не требует полноты), и saveDraftField бросал на КАЖДОМ успешном
    // определении магазина: пользователь присылал верный токен и читал
    // «Произошла ошибка при обработке настроек», название магазина терялось.
    await service.saveDraftField('1', '2', 'store_name', 'allbestwatch.ru');
    expect(call()[update].$set).toEqual({ 'draft.store_name': 'allbestwatch.ru' });
  });

  it('DRAFT_FIELDS перечисляет ВСЕ поля черновика', async () => {
    // Полнота списка — то, из-за чего дефект и случился. Проверяем прямо,
    // а не через побочный эффект одного поля.
    expect([...DRAFT_FIELDS].sort()).toEqual(
      ['business_id', 'campaign_id', 'store_name', 'token'].sort(),
    );
  });

  it('setFeature пишет один флаг, не трогая соседние', async () => {
    // Ключ попадает в путь $set (`features.<key>`) и приходит из HTTP — целиком
    // карту переписывать нельзя, иначе правка одной галочки стирала бы все
    // остальные решения администратора.
    await service.setFeature('1', '2', FEATURE.REPORT_PROFIT, false);

    expect(call()[filter]).toMatchObject({ telegramUserId: '1', botId: '2' });
    expect(call()[update].$set).toEqual({ 'features.report_profit': false });
  });

  it('setFeature НЕ создаёт запись: неизвестный пользователь — это 404, а не новый документ', async () => {
    await service.setFeature('1', '2', FEATURE.SCHEDULE, true);
    expect(call()[options]).not.toMatchObject({ upsert: true });
  });

  it('setFeature отвергает ключ вне реестра', async () => {
    await expect(service.setFeature('1', '2', 'status' as never, true)).rejects.toThrow();
    await expect(service.setFeature('1', '2', 'draft.token' as never, true)).rejects.toThrow();
  });

  it('setApproved открывает доступ с ЛЮБОГО статуса', async () => {
    // Тумблер в панели — не «решение по заявке»: фильтр по исходному статусу
    // означал бы, что он молча не срабатывает на том, кто заявку ещё не подавал.
    await service.setApproved('1', '2', true, { id: '7' });

    expect(call()[filter]).toEqual({ telegramUserId: '1', botId: '2' });
    expect(call()[update].$set).toMatchObject({ status: 'approved', decidedBy: '7' });
  });

  it('setApproved при открытии снимает отметку отказа', async () => {
    // Иначе гейт продолжал бы считать сутки запрета по протухшему rejectedAt
    // уже открытому продавцу.
    await service.setApproved('1', '2', true, { id: '7' });
    expect(call()[update].$unset).toEqual({ rejectedAt: '' });
  });

  it('setApproved при закрытии ставит rejectedAt — те же сутки запрета', async () => {
    await service.setApproved('1', '2', false, { id: '7' });

    expect(call()[update].$set).toMatchObject({ status: 'rejected', decidedBy: '7' });
    expect(call()[update].$set.rejectedAt).toBeInstanceOf(Date);
    // $unset при закрытии не нужен, а пустой объект Mongo не принимает.
    expect(call()[update].$unset).toBeUndefined();
  });

  it('setApproved не заводит запись: неизвестный пользователь — это 404', async () => {
    await service.setApproved('1', '2', true, { id: '7' });
    expect(call()[options]).not.toMatchObject({ upsert: true });
  });

  it('decide по-прежнему требует статус pending — на этом держится «первый выигрывает»', async () => {
    // setApproved его не заменяет: два администратора, одновременно нажавшие
    // кнопки в карточке заявки, не должны преуспеть оба.
    await service.decide('1', '2', 'approve', { id: '7' });
    expect(call()[filter]).toMatchObject({ status: 'pending' });
  });

  it('clearDraftField убирает ОДНО поле, не трогая остальные', async () => {
    // Нужно, когда Маркет отклонил токен: его надо снять, чтобы визард
    // переспросил, но уже введённое сохранить. clearDraft стёр бы всё.
    await service.clearDraftField('1', '2', 'token');
    expect(call()[update].$unset).toEqual({ 'draft.token': '' });

    await expect(service.clearDraftField('1', '2', 'status' as never)).rejects.toThrow();
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
